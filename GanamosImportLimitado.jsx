import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { num, formatMiles, parseGanamosTabla, todayStr } from "./lib";

// Página aparte, sin relación con App.jsx ni con AdminDashboard — se entra por
// panelcontrol.space/#ganamos. No carga turnos, empleados, billeteras ni nada
// del resto del sistema: solo busca UN turno puntual (fecha + hora de inicio,
// igual que la importación automática) y le carga su importación de Ganamos.
// Pensada para el código limitado (ganamos_import_token), que solo sirve para
// las dos funciones que esta pantalla llama — no para el PIN de admin real.

const HORAS = ["06:00", "14:00", "22:00"];

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500 font-semibold uppercase block mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function GanamosImportLimitado() {
  const [codigo, setCodigo] = useState("");
  const [fecha, setFecha] = useState(todayStr());
  const [horaInicio, setHoraInicio] = useState("06:00");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [shiftId, setShiftId] = useState(null);

  const [texto, setTexto] = useState("");
  const [parsed, setParsed] = useState(null);
  const [saldo, setSaldo] = useState("");

  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function buscarTurno() {
    if (!codigo || buscando) return;
    setBuscando(true); setShiftId(null); setBuscado(false); setResultado(null);
    const { data, error } = await supabase.rpc("ganamos_import_resolver_turno", {
      input_token: codigo, p_fecha: fecha, p_hora_inicio: horaInicio,
    });
    setBuscando(false); setBuscado(true);
    if (!error && data) setShiftId(data);
  }

  function procesar() {
    const { filas, errores } = parseGanamosTabla(texto);
    setParsed({ filas, errores });
    setResultado(null);
    if (filas.length > 0) {
      const masTardia = filas.reduce((a, b) => (b.fecha > a.fecha ? b : a));
      if (masTardia.saldoDespues != null) setSaldo(formatMiles(String(Math.round(masTardia.saldoDespues))));
    }
  }

  async function confirmar() {
    if (!parsed || !parsed.filas.length || !shiftId || importando) return;
    setImportando(true); setResultado(null);
    const ops = parsed.filas.map((f) => ({
      tipo: f.tipo, plataforma: "G", monto: formatMiles(String(Math.round(f.monto))), bono: "0",
      cliente: f.usuario, origen: null, ganamos_tx: f.tx, usuario: f.usuario,
    }));
    const { data, error } = await supabase.rpc("admin_importar_ganamos_operaciones", {
      input_admin_pin: codigo, target_shift_id: shiftId, nuevas_ops: ops,
      nuevo_saldo_gana: saldo ? formatMiles(String(Math.round(num(saldo)))) : null,
    });
    setImportando(false);
    if (error || data === null) {
      setResultado({ ok: false, mensaje: "No se pudo importar — revisá el código, o probá de nuevo." });
    } else {
      setResultado({ ok: true, mensaje: `Listo. Se agregaron ${data.length} operación${data.length !== 1 ? "es" : ""} nueva${data.length !== 1 ? "s" : ""}.` });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6">
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-black">Importar Ganamos</h1>
          <p className="text-xs text-slate-500 mt-1">Acceso limitado — solo busca un turno puntual y le carga su importación. No ve ni toca nada más del sistema.</p>
        </div>

        <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-4 space-y-3">
          <Field label="Código de importación">
            <input type="password" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input" placeholder="Código" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fecha del turno">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input" />
            </Field>
            <Field label="Hora de inicio">
              <select value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} className="input">
                {HORAS.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>
            </Field>
          </div>
          <button onClick={buscarTurno} disabled={!codigo || buscando} className="w-full bg-indigo-500 disabled:opacity-40 rounded-lg py-2 text-sm font-bold">
            {buscando ? "Buscando..." : "Buscar turno"}
          </button>
          {buscado && !shiftId && <p className="text-xs text-rose-400">No se encontró ningún turno cerrado con esos datos (o el código no es válido).</p>}
          {shiftId && <p className="text-xs text-emerald-400">Turno encontrado ✓</p>}
        </div>

        {shiftId && (
          <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-4 space-y-3">
            <Field label="Texto de Ganamos">
              <textarea
                value={texto} onChange={(e) => setTexto(e.target.value)} rows={8}
                placeholder={"TX | FECHA_HORA | TIPO | USUARIO | MONTO | SALDO_DESPUES"}
                className="input font-mono text-[11px]"
              />
            </Field>
            <button onClick={procesar} disabled={!texto} className="w-full bg-white/10 disabled:opacity-40 rounded-lg py-2 text-sm font-bold">
              Procesar
            </button>

            {parsed && (
              <div className="text-xs space-y-1">
                <p className="text-slate-400">{parsed.filas.length} operación{parsed.filas.length !== 1 ? "es" : ""} lista{parsed.filas.length !== 1 ? "s" : ""} · {parsed.errores.length} con error</p>
                {parsed.errores.map((e, i) => (
                  <p key={i} className="text-rose-400">Línea {e.linea}: {e.motivo}</p>
                ))}
              </div>
            )}

            {parsed && parsed.filas.length > 0 && (
              <>
                <Field label="Saldo real al cierre (opcional)">
                  <input value={saldo} onChange={(e) => setSaldo(formatMiles(e.target.value))} className="input text-right" placeholder="Saldo Ganamos" inputMode="numeric" />
                </Field>
                <button onClick={confirmar} disabled={importando} className="w-full bg-emerald-600 disabled:opacity-40 rounded-lg py-2 text-sm font-bold">
                  {importando ? "Importando..." : "Confirmar importación"}
                </button>
              </>
            )}

            {resultado && (
              <p className={`text-xs font-bold ${resultado.ok ? "text-emerald-400" : "text-rose-400"}`}>{resultado.mensaje}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
