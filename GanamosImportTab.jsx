import React, { useState, useEffect, useMemo } from "react";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
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
    const { filas, errores } = parseGanamosTabla(texto);
    const conTurno = filas.map((f) => ({ ...f, shift: matchShift(f.fecha, shiftsCerrados) }));
    setParsed({ filas: conTurno, errores });
  }

  const resumen = useMemo(() => {
    if (!parsed) return null;
    const sinTurno = parsed.filas.filter((f) => !f.shift);
    const conTurno = parsed.filas.filter((f) => f.shift);
    const usuariosNuevos = [...new Set(conTurno.filter((f) => !usuarios[f.usuario]).map((f) => f.usuario))];
    return { sinTurno, conTurno, usuariosNuevos };
  }, [parsed, usuarios]);

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
        supabase.rpc("admin_importar_ganamos_operaciones", { input_admin_pin: adminPin, target_shift_id: shiftId, nuevas_ops: ops })
          .then((r) => ({ shiftId, ops, ...r }))
      ));
      const fallidas = resultados.filter((r) => r.error || r.data === -1 || r.data == null);
      const ok = resultados.filter((r) => !fallidas.includes(r));
      const totalImportadas = ok.reduce((s, r) => s + r.data, 0);
      const totalIntentadas = ok.reduce((s, r) => s + r.ops.length, 0);

      setResultado({
        turnos: ok.length, importadas: totalImportadas, duplicadas: totalIntentadas - totalImportadas,
        fallidas: fallidas.length, errorDetalle: fallidas[0]?.error?.message,
      });
      setTexto(""); setParsed(null);
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
          placeholder={"Pegá acá el texto, una operación por línea:\nTX | FECHA_HORA | TIPO | USUARIO | MONTO"}
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
            <Card icon={<AlertTriangle size={15} className="text-amber-400" />} title={`${resumen.sinTurno.length} operación(es) sin turno cerrado que las cubra`} subtitle="No se van a importar — revisá que ese turno ya esté cerrado en el sistema">
              <div className="space-y-1 text-[10px] text-slate-500">
                {resumen.sinTurno.slice(0, 20).map((f, i) => (
                  <p key={i}>{f.fecha.toLocaleString("es-AR")} · {TIPO_LABEL[f.tipo]} · {f.usuario} · {money(f.monto)}</p>
                ))}
                {resumen.sinTurno.length > 20 && <p>...y {resumen.sinTurno.length - 20} más.</p>}
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
                      <span className="text-slate-400">{ORIGEN_LETRA[r.origen] || "?"} · {money(num(r.monto))} · {new Date(r.hora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className={r.estado === "ok" ? "text-emerald-400" : "text-amber-400 font-bold"}>{r.detalle}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

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
        </Card>
      )}
    </div>
  );
}
