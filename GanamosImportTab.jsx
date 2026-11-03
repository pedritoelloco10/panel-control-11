import React, { useState, useEffect, useMemo } from "react";
import { Upload, AlertTriangle, CheckCircle2, Wallet, RotateCcw } from "lucide-react";
import { Card } from "./ui";
import { supabase } from "./supabaseClient";
import { num, formatMiles, money, parseGanamosTabla, cruzarRegistrosConGanamos } from "./lib";

const ORIGEN_LETRA = { nuevo: "P", derivado: "R", lista: "L" };
const TIPO_LABEL = { carga: "Depósito", retiro: "Retiro", bono: "Bonus" };

function shiftWindow(shift) {
  const [y, m, d] = shift.fecha.split("-").map(Number);
  const [hi, mi] = shift.hora_inicio.split(":").map(Number);
  const start = new Date(y, m - 1, d, hi, mi);
  const [hf, mf] = (shift.hora_fin || "23:59").split(":").map(Number);
  const end = new Date(y, m - 1, d, hf, mf);
  if (end <= start) end.setDate(end.getDate() + 1); // turno que cruza medianoche
  return { start, end };
}

function matchShift(fecha, shiftsCerrados) {
  return shiftsCerrados.find((s) => {
    const { start, end } = shiftWindow(s);
    return fecha >= start && fecha <= end;
  }) || null;
}

// Para una operación que no cae dentro de ningún turno (ej. un hueco entre el cierre de
// uno y la apertura del siguiente), ofrece los dos turnos más cercanos a mano: el que
// cerró justo antes y el que arrancó justo después.
function turnosAdyacentes(fecha, shiftsCerrados) {
  let anterior = null, anteriorFin = null;
  let siguiente = null, siguienteInicio = null;
  shiftsCerrados.forEach((s) => {
    const { start, end } = shiftWindow(s);
    if (end <= fecha && (!anteriorFin || end > anteriorFin)) { anterior = s; anteriorFin = end; }
    if (start >= fecha && (!siguienteInicio || start < siguienteInicio)) { siguiente = s; siguienteInicio = start; }
  });
  return { anterior, siguiente };
}

// El admin ya NO elige el origen al importar — eso lo anota el empleado en su pantalla
// (carga rápida P/R/L). Acá solo se cruza contra lo que el empleado ya cargó para ese
// turno; si no hay match, la operación queda sin origen (se puede completar después).
function construirMapaOrigen(registros, filasGanamosDelTurno) {
  const cruzados = cruzarRegistrosConGanamos(registros, filasGanamosDelTurno);
  const mapa = {};
  cruzados.forEach((r) => { if (r.usuario && r.estado !== "sin_match") mapa[r.usuario] = r.origen; });
  return mapa;
}

export default function GanamosImportTab({ adminPin, shifts, onImported }) {
  const [usuarios, setUsuarios] = useState({}); // usuario -> cliente (nombre)
  const [texto, setTexto] = useState("");
  const [parsed, setParsed] = useState(null); // { filas, errores }
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [asignacionManual, setAsignacionManual] = useState({}); // tx -> shiftId (para las que no matchean solas)
  const [saldoGanaPorTurno, setSaldoGanaPorTurno] = useState({}); // shiftId -> saldo real que muestra Ganamos
  const [turnoADeshacer, setTurnoADeshacer] = useState("");
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [resultadoDeshacer, setResultadoDeshacer] = useState(null);
  const [ultimoLote, setUltimoLote] = useState(null); // [[shiftId, [tx1, tx2, ...]], ...] de la última importación confirmada
  const [deshaciendoLote, setDeshaciendoLote] = useState(false);
  const [deshaciendoLotePorTurno, setDeshaciendoLotePorTurno] = useState(false);
  const [resultadoDeshacerLote, setResultadoDeshacerLote] = useState(null);

  async function deshacerUltimoLote() {
    if (!ultimoLote || ultimoLote.length === 0) return;
    if (!window.confirm("¿Deshacer la última importación que confirmaste? Solo saca esas operaciones puntuales, no toca nada más de esos turnos.")) return;
    setDeshaciendoLote(true);
    const resultados = await Promise.all(ultimoLote.map(([shiftId, txIds]) =>
      supabase.rpc("admin_quitar_operaciones_ganamos", { input_admin_pin: adminPin, target_shift_id: shiftId, tx_a_quitar: txIds })
    ));
    setDeshaciendoLote(false);
    const totalSacadas = resultados.reduce((s, r) => s + (r.data > 0 ? r.data : 0), 0);
    setResultado((prev) => ({ ...prev, deshecho: totalSacadas }));
    setUltimoLote(null);
    onImported && onImported();
  }

  async function deshacerImportacion() {
    if (!turnoADeshacer) return;
    const shift = shiftsCerrados.find((s) => s.id === turnoADeshacer);
    if (!window.confirm(`¿Sacar TODAS las operaciones de Ganamos importadas al turno ${shift?.fecha} ${shift?.turno_label || ""} (${shift?.responsable})? Esto incluye importaciones viejas correctas, no solo la última. Las cargas rápidas y de Bet que haya en ese turno no se tocan. Después las podés volver a importar donde corresponda.`)) return;
    setDeshaciendo(true);
    setResultadoDeshacer(null);
    setResultadoDeshacerLote(null);
    const { data, error } = await supabase.rpc("admin_deshacer_importacion_ganamos", { input_admin_pin: adminPin, target_shift_id: turnoADeshacer });
    setDeshaciendo(false);
    if (error || data === -1 || data == null) {
      setResultadoDeshacer({ error: true, mensaje: error?.message || "No se pudo deshacer." });
    } else {
      setResultadoDeshacer({ error: false, cantidad: data });
      setTurnoADeshacer("");
      onImported && onImported();
    }
  }

  // Deshace solo el último lote importado a ese turno, sin depender de lo que haya
  // en memoria del navegador (busca en la base cuál fue la importación más reciente).
  async function deshacerUltimoLotePorTurno() {
    if (!turnoADeshacer) return;
    const shift = shiftsCerrados.find((s) => s.id === turnoADeshacer);
    if (!window.confirm(`¿Deshacer solo la última importación de Ganamos que se hizo al turno ${shift?.fecha} ${shift?.turno_label || ""} (${shift?.responsable})? Las importaciones anteriores a esa quedan intactas.`)) return;
    setDeshaciendoLotePorTurno(true);
    setResultadoDeshacer(null);
    setResultadoDeshacerLote(null);
    const { data, error } = await supabase.rpc("admin_deshacer_ultimo_lote_ganamos", { input_admin_pin: adminPin, target_shift_id: turnoADeshacer });
    setDeshaciendoLotePorTurno(false);
    if (error || data == null) {
      setResultadoDeshacerLote({ error: true, mensaje: error?.message || "No se pudo deshacer." });
    } else if (data.length === 0) {
      setResultadoDeshacerLote({ error: true, mensaje: "Ese turno no tiene operaciones de Ganamos importadas." });
    } else {
      setResultadoDeshacerLote({ error: false, cantidad: data.length });
      setTurnoADeshacer("");
      onImported && onImported();
    }
  }

  // Asigna de una todas las operaciones "sin turno" actuales a su turno anterior o
  // siguiente respectivo (cada una al suyo, no a un turno fijo) — para no tener que
  // clickear una por una cuando hay muchas en el mismo hueco.
  function asignarTodasSinTurno(direccion) {
    if (!resumen) return;
    setAsignacionManual((prev) => {
      const next = { ...prev };
      resumen.sinTurno.forEach((f) => {
        if (direccion === null) { delete next[f.tx]; return; }
        const { anterior, siguiente } = turnosAdyacentes(f.fecha, shiftsCerrados);
        const elegido = direccion === "anterior" ? anterior : siguiente;
        if (elegido) next[f.tx] = elegido.id;
      });
      return next;
    });
  }

  async function cargarUsuarios() {
    const { data } = await supabase.rpc("admin_get_ganamos_usuarios", { input_admin_pin: adminPin });
    const map = {};
    (data || []).forEach((u) => { map[u.usuario] = u.cliente; });
    setUsuarios(map);
  }
  useEffect(() => { cargarUsuarios(); }, []);

  const shiftsCerrados = useMemo(() => (shifts || []).filter((s) => s.status === "cerrado"), [shifts]);

  function procesar() {
    setResultado(null);
    setAsignacionManual({});
    setSaldoGanaPorTurno({});
    const { filas, errores } = parseGanamosTabla(texto);
    const conTurno = filas.map((f) => ({ ...f, shift: matchShift(f.fecha, shiftsCerrados) }));
    setParsed({ filas: conTurno, errores });
  }

  const shiftsCerradosPorId = useMemo(() => {
    const map = {};
    shiftsCerrados.forEach((s) => { map[s.id] = s; });
    return map;
  }, [shiftsCerrados]);

  const resumen = useMemo(() => {
    if (!parsed) return null;
    const resueltas = parsed.filas.map((f) => {
      if (f.shift) return f;
      const asignado = asignacionManual[f.tx];
      return asignado ? { ...f, shift: shiftsCerradosPorId[asignado] || null } : f;
    });
    const sinTurno = resueltas.filter((f) => !f.shift);
    const conTurno = resueltas.filter((f) => f.shift);
    const usuariosNuevos = [...new Set(conTurno.filter((f) => !usuarios[f.usuario]).map((f) => f.usuario))];
    return { sinTurno, conTurno, usuariosNuevos };
  }, [parsed, usuarios, asignacionManual, shiftsCerradosPorId]);

  // Cruza, por turno, lo que el empleado anotó en vivo (tipo "registro_rapido" dentro de
  // shift.ops) contra lo que trajo Ganamos para ese mismo turno — valida el % de bono según
  // el origen que marcó el empleado, y de paso resuelve el origen de cada carga. Si todavía
  // no existe la pantalla de carga rápida del empleado, esto no muestra nada (no hay
  // registros que cruzar) y las cargas quedan sin origen hasta que sí los haya.
  const cruces = useMemo(() => {
    if (!resumen) return [];
    const porShiftId = {};
    resumen.conTurno.forEach((f) => { (porShiftId[f.shift.id] ||= []).push(f); });
    return Object.entries(porShiftId).map(([shiftId, filas]) => {
      const shift = filas[0].shift;
      const registros = (shift.ops || []).filter((o) => o.tipo === "registro_rapido");
      if (registros.length === 0) return null;
      return { shift, resultados: cruzarRegistrosConGanamos(registros, filas) };
    }).filter(Boolean);
  }, [resumen]);

  const shiftsAImportar = useMemo(() => {
    if (!resumen) return [];
    const vistos = new Map();
    resumen.conTurno.forEach((f) => { if (!vistos.has(f.shift.id)) vistos.set(f.shift.id, f.shift); });
    return [...vistos.values()];
  }, [resumen]);

  // Si las filas traen el saldo-después de cada operación (columna nueva del formato),
  // se sugiere solo el saldo de cierre de cada turno: el de la operación más tardía que
  // le quedó asignada. Sigue siendo editable por si hace falta corregirlo a mano.
  const saldoSugeridoPorTurno = useMemo(() => {
    if (!resumen) return {};
    const masTardia = {};
    resumen.conTurno.forEach((f) => {
      if (f.saldoDespues == null) return;
      const actual = masTardia[f.shift.id];
      if (!actual || f.fecha > actual.fecha) masTardia[f.shift.id] = f;
    });
    const out = {};
    Object.entries(masTardia).forEach(([shiftId, f]) => { out[shiftId] = String(Math.round(f.saldoDespues)); });
    return out;
  }, [resumen]);

  useEffect(() => {
    setSaldoGanaPorTurno((prev) => {
      let cambio = false;
      const next = { ...prev };
      Object.entries(saldoSugeridoPorTurno).forEach(([shiftId, val]) => {
        if (next[shiftId] === undefined) { next[shiftId] = val; cambio = true; }
      });
      return cambio ? next : prev;
    });
  }, [saldoSugeridoPorTurno]);

  async function confirmarImportacion() {
    if (!resumen || resumen.conTurno.length === 0) return;
    setImportando(true);
    try {
      // 1) Registrar los usuarios nuevos con su usuario de Ganamos como nombre — sin pedir
      // nada más, no bloquea la importación.
      await Promise.all(resumen.usuariosNuevos.map((u) =>
        supabase.rpc("admin_set_ganamos_usuario", { input_admin_pin: adminPin, p_usuario: u, p_cliente: u })
      ));
      const clientePorUsuario = { ...usuarios };
      resumen.usuariosNuevos.forEach((u) => { clientePorUsuario[u] = u; });

      // 2) Agrupar por turno y resolver el origen de cada carga cruzando contra lo que
      // anotó el empleado en ese turno (si no hay match, queda sin origen).
      const porTurno = {};
      resumen.conTurno.forEach((f) => { (porTurno[f.shift.id] ||= []).push(f); });

      const entradas = Object.entries(porTurno).map(([shiftId, filas]) => {
        const shift = filas[0].shift;
        const registros = (shift.ops || []).filter((o) => o.tipo === "registro_rapido");
        const mapaOrigen = registros.length ? construirMapaOrigen(registros, filas) : {};
        const ops = filas.map((f) => ({
          tipo: f.tipo, plataforma: "G", monto: formatMiles(String(Math.round(f.monto))), bono: "0",
          cliente: clientePorUsuario[f.usuario] || f.usuario,
          origen: f.tipo === "carga" ? (mapaOrigen[f.usuario] || null) : null,
          ganamos_tx: f.tx, usuario: f.usuario,
        }));
        return [shiftId, ops];
      });

      const resultados = await Promise.all(entradas.map(([shiftId, ops]) =>
        supabase.rpc("admin_importar_ganamos_operaciones", {
          input_admin_pin: adminPin, target_shift_id: shiftId, nuevas_ops: ops,
          nuevo_saldo_gana: saldoGanaPorTurno[shiftId] ? formatMiles(String(Math.round(num(saldoGanaPorTurno[shiftId])))) : null,
        }).then((r) => ({ shiftId, ops, ...r }))
      ));
      // data ahora es la lista de ganamos_tx que se agregaron de verdad (no las que ya
      // estaban de una importación anterior) — eso es justo lo que hace falta guardar
      // para poder deshacer ESTE lote puntual más tarde, sin tocar nada más viejo.
      const fallidas = resultados.filter((r) => r.error || r.data == null);
      const ok = resultados.filter((r) => !fallidas.includes(r));
      const totalImportadas = ok.reduce((s, r) => s + r.data.length, 0);
      const totalIntentadas = ok.reduce((s, r) => s + r.ops.length, 0);

      setResultado({
        turnos: ok.length, importadas: totalImportadas, duplicadas: totalIntentadas - totalImportadas,
        fallidas: fallidas.length, errorDetalle: fallidas[0]?.error?.message,
      });
      setUltimoLote(ok.filter((r) => r.data.length > 0).map((r) => [r.shiftId, r.data]));
      setTexto(""); setParsed(null); setAsignacionManual({}); setSaldoGanaPorTurno({});
      await cargarUsuarios();
      onImported && onImported();
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card icon={<Upload size={15} />} title="Importar operaciones de Ganamos" subtitle="Pegá la tabla de Depósitos/Retiros Jugadores — se reparte sola por turno">
        <p className="text-[11px] text-slate-500 mb-2">
          Solo se puede importar a <b>turnos ya cerrados</b> (nunca a uno abierto ahora mismo, para no pisar el autoguardado del empleado).
          Pegá acá lo que te pase la otra sesión conectada a Ganamos — también acepta la tabla cruda copiada directo del navegador.
        </p>
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={"Pegá acá el texto, una operación por línea:\nTX | FECHA_HORA | TIPO | USUARIO | MONTO | SALDO_DESPUES"}
          className="w-full h-32 bg-white/5 ring-1 ring-white/10 rounded-lg p-2.5 text-[11px] font-mono mb-2 focus:outline-none focus:ring-indigo-500"
        />
        <button onClick={procesar} disabled={!texto.trim()} className="bg-gradient-to-r from-indigo-500 to-violet-600 font-bold py-2 px-4 rounded-lg text-xs disabled:opacity-40">
          Procesar
        </button>
      </Card>

      {parsed && resumen && (
        <>
          {parsed.errores.length > 0 && (
            <Card icon={<AlertTriangle size={15} className="text-amber-400" />} title={`${parsed.errores.length} línea(s) no reconocida(s)`}>
              <div className="space-y-1 text-[10px] text-slate-500">
                {parsed.errores.map((e, i) => <p key={i}>Línea {e.linea}: {e.motivo} — <span className="font-mono">{e.texto.slice(0, 80)}</span></p>)}
              </div>
            </Card>
          )}

          {resumen.sinTurno.length > 0 && (
            <Card icon={<AlertTriangle size={15} className="text-amber-400" />} title={`${resumen.sinTurno.length} operación(es) sin turno cerrado que las cubra`} subtitle="Elegí vos a cuál turno entra cada una, o dejala afuera — por defecto no se importa ninguna">
              {resumen.sinTurno.length > 1 && (
                <div className="flex gap-1.5 flex-wrap mb-2.5 pb-2.5 border-b border-white/10">
                  <span className="text-[10px] text-slate-500 self-center mr-0.5">Asignar todas:</span>
                  <button onClick={() => asignarTodasSinTurno(null)} className="text-[10px] rounded-lg px-2 py-1 font-bold bg-white/10 text-slate-300">Ninguna (no importar)</button>
                  <button onClick={() => asignarTodasSinTurno("anterior")} className="text-[10px] rounded-lg px-2 py-1 font-bold bg-indigo-500/20 text-indigo-300">Todas a su turno anterior</button>
                  <button onClick={() => asignarTodasSinTurno("siguiente")} className="text-[10px] rounded-lg px-2 py-1 font-bold bg-indigo-500/20 text-indigo-300">Todas a su turno siguiente</button>
                </div>
              )}
              <div className="space-y-2">
                {resumen.sinTurno.slice(0, 20).map((f, i) => {
                  const { anterior, siguiente } = turnosAdyacentes(f.fecha, shiftsCerrados);
                  const elegido = asignacionManual[f.tx]; // undefined = "no importar" (default)
                  const btnClass = (activo) => `text-[10px] rounded-lg px-2 py-1 font-bold ${activo ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-400"}`;
                  return (
                    <div key={i} className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[11px] text-slate-300 mb-1.5">
                        {f.fecha.toLocaleString("es-AR", { hour12: false })} · {TIPO_LABEL[f.tipo]} · {f.usuario} · {money(f.monto)}
                      </p>
                      <div className="flex gap-1.5 flex-wrap">
                        <button onClick={() => setAsignacionManual((p) => { const n = { ...p }; delete n[f.tx]; return n; })} className={btnClass(!elegido)}>
                          No importar
                        </button>
                        {anterior && (() => {
                          const minutos = Math.round((f.fecha - shiftWindow(anterior).end) / 60000);
                          return (
                            <button onClick={() => setAsignacionManual((p) => ({ ...p, [f.tx]: anterior.id }))} className={btnClass(elegido === anterior.id)}>
                              Turno anterior ({anterior.responsable}, {anterior.fecha} {anterior.turno_label || ""}) · cerró hace {minutos} min
                            </button>
                          );
                        })()}
                        {siguiente && (() => {
                          const minutos = Math.round((shiftWindow(siguiente).start - f.fecha) / 60000);
                          return (
                            <button onClick={() => setAsignacionManual((p) => ({ ...p, [f.tx]: siguiente.id }))} className={btnClass(elegido === siguiente.id)}>
                              Turno siguiente ({siguiente.responsable}, {siguiente.fecha} {siguiente.turno_label || ""}) · abre en {minutos} min
                            </button>
                          );
                        })()}
                        {!anterior && !siguiente && <p className="text-[10px] text-slate-600 self-center">No hay ningún turno cerrado cerca de esta fecha.</p>}
                      </div>
                    </div>
                  );
                })}
                {resumen.sinTurno.length > 20 && <p className="text-[10px] text-slate-500">...y {resumen.sinTurno.length - 20} más.</p>}
              </div>
            </Card>
          )}

          {resumen.usuariosNuevos.length > 0 && (
            <Card icon={<CheckCircle2 size={15} className="text-emerald-400" />} title={`${resumen.usuariosNuevos.length} usuario(s) de Ganamos nuevo(s)`} subtitle="Se registran solos con su usuario de Ganamos como nombre, sin que haya que hacer nada">
              <p className="text-[11px] text-slate-500">{resumen.usuariosNuevos.slice(0, 15).join(", ")}{resumen.usuariosNuevos.length > 15 ? `, y ${resumen.usuariosNuevos.length - 15} más` : ""}</p>
            </Card>
          )}

          {cruces.map(({ shift, resultados }) => {
            const revisar = resultados.filter((r) => r.estado !== "ok");
            return (
              <Card
                key={shift.id}
                icon={revisar.length > 0 ? <AlertTriangle size={15} className="text-amber-400" /> : <CheckCircle2 size={15} className="text-emerald-400" />}
                title={`Cruce con lo que anotó el empleado — ${shift.fecha} ${shift.turno_label || ""}`}
                subtitle={`${shift.responsable} · ${resultados.length - revisar.length}/${resultados.length} OK — así se resuelve el origen de cada carga`}
              >
                <div className="space-y-1.5">
                  {resultados.map((r, i) => (
                    <div key={i} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${r.estado === "ok" ? "bg-white/5" : "bg-amber-500/10 ring-1 ring-amber-500/30"}`}>
                      <span className="text-slate-400">{ORIGEN_LETRA[r.origen] || "?"} · {money(num(r.monto))} · {new Date(r.hora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                      <span className={r.estado === "ok" ? "text-emerald-400" : "text-amber-400 font-bold"}>{r.detalle}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          <Card icon={<Wallet size={15} className="text-indigo-300" />} title="Saldo real de Ganamos al cierre de cada turno" subtitle="Se completa solo con el saldo de la última operación pegada — revisalo y corregilo si hace falta">
            <div className="space-y-2">
              {shiftsAImportar.map((shift) => (
                <div key={shift.id} className="flex items-center gap-2">
                  <p className="text-[11px] text-slate-400 flex-1">{shift.fecha} {shift.turno_label || ""} · {shift.responsable}</p>
                  <div className="w-44 flex-none">
                    <input
                      inputMode="decimal" placeholder="Saldo Ganamos" value={saldoGanaPorTurno[shift.id] || ""}
                      onChange={(e) => setSaldoGanaPorTurno((p) => ({ ...p, [shift.id]: e.target.value }))}
                      className="w-full bg-black/20 rounded-lg px-2.5 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    {saldoGanaPorTurno[shift.id] && (
                      <p className="text-[10px] text-slate-500 text-right mt-0.5">
                        = {money(Math.round(num(saldoGanaPorTurno[shift.id])))}
                        {saldoSugeridoPorTurno[shift.id] === saldoGanaPorTurno[shift.id] && <span className="text-indigo-400"> (auto)</span>}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Opcional — si lo dejás vacío, el control de fichas GANA de ese turno queda sin verificar hasta que lo cargues en una importación siguiente.</p>
          </Card>

          <Card icon={<CheckCircle2 size={15} className="text-emerald-400" />} title={`${resumen.conTurno.length} operación(es) listas para importar`} subtitle={`En ${new Set(resumen.conTurno.map((f) => f.shift.id)).size} turno(s)`}>
            {cruces.length === 0 && (
              <p className="text-[11px] text-slate-500 mb-2">
                Ninguno de estos turnos tiene registros de carga rápida del empleado todavía, así que las cargas van a entrar sin origen (P/R/L) por ahora — se puede completar más adelante.
              </p>
            )}
            <button
              onClick={confirmarImportacion}
              disabled={importando || resumen.conTurno.length === 0}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 font-bold py-2.5 rounded-lg text-xs disabled:opacity-40"
            >
              {importando ? "Importando..." : "Confirmar importación"}
            </button>
          </Card>
        </>
      )}

      {resultado && (
        <Card icon={resultado.fallidas > 0 ? <AlertTriangle size={15} className="text-amber-400" /> : <CheckCircle2 size={15} className="text-emerald-400" />} title={resultado.fallidas > 0 ? "Importación con errores" : "Importación hecha"}>
          <p className="text-xs text-slate-400">
            {resultado.importadas} operación(es) agregada(s) en {resultado.turnos} turno(s).
            {resultado.duplicadas > 0 && ` ${resultado.duplicadas} ya estaban importadas (se saltearon solas).`}
          </p>
          {resultado.fallidas > 0 && (
            <p className="text-xs text-amber-400 mt-1.5">
              {resultado.fallidas} turno(s) no se pudieron actualizar{resultado.errorDetalle ? ` — ${resultado.errorDetalle}` : ""}. Probá de nuevo pegando la misma tabla; lo ya importado no se duplica.
            </p>
          )}
          {resultado.deshecho != null && (
            <p className="text-xs text-rose-400 mt-1.5">Deshecho: se sacaron {resultado.deshecho} operación(es) de esta importación.</p>
          )}
          {ultimoLote && ultimoLote.length > 0 && (
            <button
              onClick={deshacerUltimoLote}
              disabled={deshaciendoLote}
              className="w-full bg-rose-500/15 text-rose-300 font-bold py-2 rounded-lg text-xs mt-2 disabled:opacity-40"
            >
              {deshaciendoLote ? "Deshaciendo..." : "¿Te equivocaste? Deshacer esta importación"}
            </button>
          )}
        </Card>
      )}

      <Card icon={<RotateCcw size={15} className="text-rose-400" />} title="Deshacer una importación" subtitle="Por si se cargó al turno equivocado — no toca el turno en sí ni lo que cargó el empleado a mano">
        <select value={turnoADeshacer} onChange={(e) => setTurnoADeshacer(e.target.value)} className="w-full bg-black/20 rounded-lg px-2.5 py-2 text-xs">
          <option value="">Elegí un turno...</option>
          {shiftsCerrados.map((s) => (
            <option key={s.id} value={s.id}>{s.fecha} · {s.turno_label || ""} · {s.responsable}</option>
          ))}
        </select>
        <div className="flex gap-2 mt-2">
          <button
            onClick={deshacerUltimoLotePorTurno}
            disabled={!turnoADeshacer || deshaciendoLotePorTurno}
            className="flex-1 bg-amber-500/20 text-amber-300 font-bold px-3 py-2 rounded-lg text-xs disabled:opacity-40"
          >
            {deshaciendoLotePorTurno ? "Sacando..." : "Deshacer solo la última importación"}
          </button>
          <button
            onClick={deshacerImportacion}
            disabled={!turnoADeshacer || deshaciendo}
            className="flex-1 bg-rose-500/20 text-rose-300 font-bold px-3 py-2 rounded-lg text-xs disabled:opacity-40"
          >
            {deshaciendo ? "Sacando..." : "Deshacer TODO de Ganamos"}
          </button>
        </div>
        {resultadoDeshacerLote && (
          <p className={`text-xs mt-2 ${resultadoDeshacerLote.error ? "text-rose-400" : "text-emerald-400"}`}>
            {resultadoDeshacerLote.error ? resultadoDeshacerLote.mensaje : `Se sacaron ${resultadoDeshacerLote.cantidad} operación(es) de la última importación de ese turno. Las importaciones anteriores quedaron intactas.`}
          </p>
        )}
        {resultadoDeshacer && (
          <p className={`text-xs mt-2 ${resultadoDeshacer.error ? "text-rose-400" : "text-emerald-400"}`}>
            {resultadoDeshacer.error ? resultadoDeshacer.mensaje : `Se sacaron ${resultadoDeshacer.cantidad} operación(es) de Ganamos de ese turno (todas). Ya podés reimportarlas donde corresponda.`}
          </p>
        )}
      </Card>
    </div>
  );
}
