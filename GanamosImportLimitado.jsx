import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { formatMiles, parseGanamosTabla } from "./lib";

// Página aparte, sin relación con App.jsx ni con AdminDashboard — se entra por
// panelcontrol.space/#ganamos. No carga turnos, empleados, billeteras ni nada
// del resto del sistema. Pegás el texto de Ganamos de la franja que sea (puede
// abarcar varios turnos reales, cortos o irregulares) y el reparto a cada
// turno lo hace sola la función de la base (admin_importar_ganamos_por_horario),
// por hora exacta de cada operación — esta pantalla nunca ve la lista de
// turnos ni sus datos. Pensada para el código limitado (ganamos_import_token),
// que solo sirve para esta función — no para el PIN de admin real.

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500 font-semibold uppercase block mb-1">{label}</span>
      {children}
    </label>
  );
}

function fechaHoraSql(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function GanamosImportLimitado() {
  const [codigo, setCodigo] = useState("");
  const [texto, setTexto] = useState("");
  const [parsed, setParsed] = useState(null);

  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  function procesar() {
    const { filas, errores } = parseGanamosTabla(texto);
    setParsed({ filas, errores });
    setResultado(null);
  }

  async function confirmar() {
    if (!codigo || !parsed || !parsed.filas.length || importando) return;
    setImportando(true); setResultado(null);
    const operaciones = parsed.filas.map((f) => ({
      tipo: f.tipo, plataforma: "G", monto: formatMiles(String(Math.round(f.monto))), bono: "0",
      cliente: f.usuario, usuario: f.usuario, ganamos_tx: f.tx,
      fecha_hora: fechaHoraSql(f.fecha),
      saldo_despues: f.saldoDespues != null ? String(Math.round(f.saldoDespues)) : null,
    }));
    const { data, error } = await supabase.rpc("admin_importar_ganamos_por_horario", {
      input_token: codigo, operaciones,
    });
    setImportando(false);
    if (error || data === null) {
      setResultado({ ok: false, mensaje: "No se pudo importar — revisá el código, o probá de nuevo." });
    } else {
      const sinTurno = data.sin_turno || [];
      const yaExistia = data.ya_existia || [];
      let msg = `Listo. Se repartió en ${data.turnos_tocados} turno${data.turnos_tocados !== 1 ? "s" : ""}, ${data.operaciones_agregadas} operación${data.operaciones_agregadas !== 1 ? "es" : ""} nueva${data.operaciones_agregadas !== 1 ? "s" : ""}.`;
      if (sinTurno.length > 0) msg += ` ${sinTurno.length} quedaron sin turno (TX: ${sinTurno.join(", ")}) — no hay ningún turno cerrado cuyo horario las contenga.`;
      if (yaExistia.length > 0) msg += ` ${yaExistia.length} ya estaban cargadas en algún turno, no se tocaron (TX: ${yaExistia.join(", ")}).`;
      setResultado({ ok: true, mensaje: msg });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6">
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-black">Importar Ganamos</h1>
          <p className="text-xs text-slate-500 mt-1">Acceso limitado — pega las operaciones de Ganamos de la franja que sea (pueden ser varios turnos) y cada una se reparte sola al turno que le corresponde según su horario. No ve ni toca nada más del sistema.</p>
        </div>

        <div className="bg-white/5 ring-1 ring-white/10 rounded-xl p-4 space-y-3">
          <Field label="Código de importación">
            <input type="password" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="input" placeholder="Código" autoComplete="off" />
          </Field>

          <Field label="Texto de Ganamos">
            <textarea
              value={texto} onChange={(e) => setTexto(e.target.value)} rows={10}
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
            <button onClick={confirmar} disabled={!codigo || importando} className="w-full bg-emerald-600 disabled:opacity-40 rounded-lg py-2 text-sm font-bold">
              {importando ? "Importando..." : "Confirmar importación"}
            </button>
          )}

          {resultado && (
            <p className={`text-xs font-bold ${resultado.ok ? "text-emerald-400" : "text-rose-400"}`}>{resultado.mensaje}</p>
          )}
        </div>
      </div>
    </div>
  );
}
