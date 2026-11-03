import React, { useState, useEffect } from "react";
import { Users, Wallet, Coins, TrendingUp, CheckCircle2, Save, Trash2, Plus, Lock, WifiOff, AlertTriangle, Megaphone, Zap } from "lucide-react";
import { Card, Field, Badge } from "./ui";
import { PLATFORMS, num, money, classifyTurno, uid, formatMiles } from "./lib";
import { supabase } from "./supabaseClient";

// Pantalla única para el empleado — reemplaza Turno + Operaciones por algo más liviano:
// el empleado ya no tipea plataforma/cliente/bono por operación (eso lo trae después la
// importación de Ganamos). Acá solo anota origen + monto cuando entra un cliente, cuenta
// los mensajes de publicidad, y al cerrar declara cuánto hay en cada billetera.
//
// Todavía no está conectada en App.jsx a propósito — se activa recién cuando se decida.

const ORIGEN_OPCIONES = [
  ["nuevo", "P", "Publicidad"],
  ["derivado", "R", "Referido"],
  ["lista", "L", "Lista"],
];

export default function TurnoUnificado({ wallets, draft, identity }) {
  const {
    meta, setMeta, billInicio, billCierre, setBillCierre,
    stockInicio, stockCierreInf, setStockCierreInf,
    ops, setOps, bajadas, setBajadas, movs, setMovs, notas, setNotas,
    expected, cierreCheck, saving, error, saved, autosaveError, submitTurno,
    carriedFrom, otherOpenBy, refuerzoPropioAbierto, loadError,
  } = draft;

  // OJO: a propósito NO usa session_get_leads para esto — esa función reparte leads
  // nuevos y toma un lock cada vez que se llama (ver migrations/2026-11-04-...).
  // session_mis_mensajes_hoy es pura lectura, no mueve nada.
  const [mensajesHoy, setMensajesHoy] = useState(null);
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    supabase.rpc("session_mis_mensajes_hoy", { input_token: identity.token }).then(({ data }) => {
      if (!cancelled) setMensajesHoy(data ?? 0);
    });
    return () => { cancelled = true; };
  }, [identity]);

  const [origenSel, setOrigenSel] = useState(null);
  const [montoRapido, setMontoRapido] = useState("");
  const registros = (ops || []).filter((o) => o.tipo === "registro_rapido").sort((a, b) => (a.hora < b.hora ? 1 : -1));

  function agregarCargaRapida() {
    if (!origenSel || !montoRapido) return;
    setOps([...ops, { id: uid(), tipo: "registro_rapido", origen: origenSel, monto: montoRapido, hora: new Date().toISOString() }]);
    setOrigenSel(null); setMontoRapido("");
  }
  function eliminarRegistro(id) {
    setOps(ops.filter((o) => o.id !== id));
  }

  if (loadError) {
    return (
      <div className="pt-5">
        <Card icon={<AlertTriangle size={15} />} title="No se pudo abrir el turno" subtitle="No se cargó nada — no es seguro seguir">
          <p className="text-sm text-slate-300 mb-2">{loadError}</p>
          <p className="text-sm text-slate-400">No se abrió ninguna caja para no arriesgar arrancar con las billeteras o fichas mal. Avisale a tu encargado con este mensaje antes de seguir.</p>
        </Card>
      </div>
    );
  }
  if (refuerzoPropioAbierto) {
    return (
      <div className="pt-5">
        <Card icon={<Lock size={15} />} title="Estás trabajando como refuerzo" subtitle="No podés abrir una caja mientras tanto">
          <p className="text-sm text-slate-300 mb-2">Tenés tu sesión de refuerzo abierta en <b>Bases</b>. Mientras siga así, no podés abrir turno.</p>
          <p className="text-sm text-slate-400">Si terminaste, andá a <b>Bases</b> y tocá <b>"Cerrar sesión"</b>.</p>
        </Card>
      </div>
    );
  }
  if (otherOpenBy) {
    return (
      <div className="pt-5">
        <Card icon={<Lock size={15} />} title="El turno ya está abierto" subtitle={`A cargo de ${otherOpenBy.nombre}`}>
          <p className="text-sm text-slate-300 mb-2"><b>{otherOpenBy.nombre}</b> ya tiene la caja abierta desde las {otherOpenBy.hora?.slice(0, 5)}. No se abre otra caja mientras esta siga activa.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="pt-5">
      {saved && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
          <CheckCircle2 size={16} /> Turno guardado
        </div>
      )}
      {autosaveError && (
        <div className="bg-rose-500/15 ring-1 ring-rose-500/40 rounded-xl px-3.5 py-2.5 mb-3 flex items-center gap-2">
          <WifiOff size={15} className="text-rose-400 flex-none" />
          <p className="text-xs text-rose-300 font-bold">No se pudo guardar el último cambio — revisá tu conexión. No cierres la pestaña hasta que este aviso desaparezca.</p>
        </div>
      )}

      <Card icon={<Users size={15} />} title="Datos del turno" subtitle={`Operando como ${identity?.nombre || "—"}`}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Field label="Fecha"><input type="date" value={meta.fecha} onChange={(e) => setMeta({ ...meta, fecha: e.target.value })} className="input" /></Field>
          <Field label="Hora de inicio"><input type="time" value={meta.horaInicio} onChange={(e) => setMeta({ ...meta, horaInicio: e.target.value })} className="input" /></Field>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">Franja detectada: {classifyTurno(meta.horaInicio)}</p>
      </Card>

      <Card icon={<Wallet size={15} />} title="Billeteras — arrastre" subtitle={carriedFrom ? `Del cierre de ${carriedFrom.responsable} · ${carriedFrom.fecha} ${carriedFrom.hora}` : "Primer turno cargado — sin cierre anterior"}>
        <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto -mx-1 px-1">
          {wallets.map((w) => (
            <div key={w} className="bg-black/20 rounded-lg px-2.5 py-2">
              <p className="text-[9px] text-slate-500 uppercase mb-0.5">{w}</p>
              <p className="text-sm font-bold">{money(num(billInicio[w] || 0))}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {PLATFORMS.map((p) => (
            <div key={p.key} className="bg-black/20 rounded-lg px-2.5 py-2">
              <p className="text-[9px] text-slate-500 uppercase mb-0.5">Fichas {p.label} — inicio</p>
              <p className="text-sm font-bold">{money(num(stockInicio[p.key] || 0))}</p>
              <p className="text-[10px] text-indigo-300 font-bold">Esperado ahora: {money(expected.stock[p.key])}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<Megaphone size={15} />} title="Mensajes de publicidad hoy">
        <p className="text-3xl font-black text-indigo-300">{mensajesHoy === null ? "…" : mensajesHoy}</p>
      </Card>

      <Card icon={<Zap size={15} />} title="Registrar carga" subtitle="Origen + monto — la hora se pone sola">
        <div className="flex gap-2 mb-2">
          {ORIGEN_OPCIONES.map(([key, letra, label]) => (
            <button
              key={key} onClick={() => setOrigenSel(key)} title={label}
              className={`flex-1 py-2.5 rounded-lg text-sm font-black ${origenSel === key ? "bg-emerald-500 text-white" : "bg-white/5 text-slate-500"}`}
            >{letra}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            inputMode="numeric" value={montoRapido} placeholder="Monto"
            onChange={(e) => setMontoRapido(formatMiles(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") agregarCargaRapida(); }}
            className="input flex-1"
          />
          <button onClick={agregarCargaRapida} disabled={!origenSel || !montoRapido} className="bg-gradient-to-r from-indigo-500 to-violet-600 disabled:opacity-40 font-bold px-4 rounded-lg text-sm flex items-center gap-1">
            <Plus size={14} /> Sumar
          </button>
        </div>
        {registros.length > 0 && (
          <div className="mt-3 space-y-1">
            {registros.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-white/5 rounded-lg px-2.5 py-1.5 text-xs">
                <span className="font-bold text-slate-300">
                  {ORIGEN_OPCIONES.find(([k]) => k === r.origen)?.[1]} · {money(num(r.monto))}
                  <span className="text-slate-500 font-normal"> · {new Date(r.hora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                <button onClick={() => eliminarRegistro(r.id)} className="text-slate-600 hover:text-rose-400"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon={<TrendingUp size={15} className="rotate-180" />} title="Bajadas y movimientos">
        <p className="hint">Bajadas — salidas de dinero del panel</p>
        <ListEditor
          items={bajadas} setItems={setBajadas} addLabel="Agregar bajada"
          fields={[
            { key: "billetera", type: "select", options: ["(otro)"], placeholder: "Billetera" },
            { key: "monto", type: "text", placeholder: "Monto", numeric: true },
            { key: "destino", type: "select", options: ["Efectivo (ganancia)", "Compra de fichas", "Gasto de oficina"], placeholder: "Destino" },
            { key: "nota", type: "text", placeholder: "Nota (si es gasto, detallar en qué)" },
          ]}
          wallets={wallets}
        />
        <p className="hint mt-4">Compra / Traspasos / Recupero de fichas</p>
        <ListEditor
          items={movs} setItems={setMovs} addLabel="Agregar movimiento"
          fields={[
            { key: "tipo", type: "select", options: ["Compra", "Traspaso", "Recupero"], placeholder: "Tipo" },
            { key: "plataforma", type: "select", options: ["B", "G"], placeholder: "Plataforma" },
            { key: "monto", type: "text", placeholder: "Monto (±)", numeric: true },
            { key: "nota", type: "text", placeholder: "Nota" },
          ]}
        />
      </Card>

      <Card icon={<Wallet size={15} />} title="Billeteras — cierre">
        <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto -mx-1 px-1">
          {wallets.map((w, i) => (
            <Field key={w} label={w}>
              <input
                inputMode="numeric" value={billCierre[w] || ""} data-cierre-idx={i}
                onChange={(e) => setBillCierre({ ...billCierre, [w]: formatMiles(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); document.querySelector(`[data-cierre-idx="${i + 1}"]`)?.focus(); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); document.querySelector(`[data-cierre-idx="${Math.max(0, i - 1)}"]`)?.focus(); }
                }}
                placeholder="0" className="input"
              />
            </Field>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-2">↑ ↓ o Enter para moverte entre billeteras.</p>
      </Card>

      <Card icon={<Coins size={15} />} title="Stock de fichas — cierre (informado)">
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((p, i) => (
            <Field key={p.key} label={`${p.label} — cierre`}>
              <input
                inputMode="numeric" value={stockCierreInf[p.key]} data-ficha-idx={i}
                onChange={(e) => setStockCierreInf({ ...stockCierreInf, [p.key]: e.target.value.replace(/[^\d]/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); document.querySelector(`[data-ficha-idx="${i + 1}"]`)?.focus(); }
                  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); document.querySelector(`[data-ficha-idx="${Math.max(0, i - 1)}"]`)?.focus(); }
                }}
                placeholder="0" className="input"
              />
            </Field>
          ))}
        </div>
      </Card>

      {cierreCheck.anyCierreData && (
        <Card icon={<CheckCircle2 size={15} />} title="Control de cierre" subtitle="Comparación automática — esperado vs. contado">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-black/20 rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-slate-500 mb-1">Efectivo</p>
              <Badge ok={Math.abs(cierreCheck.diffEfectivo) < 1} textBad={`Dif. ${money(cierreCheck.diffEfectivo)}`} />
            </div>
            {PLATFORMS.map((p) => (
              <div key={p.key} className="bg-black/20 rounded-xl p-2.5 text-center">
                <p className="text-[10px] text-slate-500 mb-1">Fichas {p.label}</p>
                <Badge ok={Math.abs(cierreCheck.diffFichas[p.key]) < 1} textBad={`Dif. ${money(cierreCheck.diffFichas[p.key])}`} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2">Esta comparación es solo una referencia en vivo — el control real lo hace tu encargado cuando cruza esto contra Ganamos al cierre.</p>
        </Card>
      )}

      <Card icon={<Users size={15} />} title="Cierre">
        <Field label="Hora de fin"><input type="time" value={meta.horaFin} onChange={(e) => setMeta({ ...meta, horaFin: e.target.value })} className="input mb-3" /></Field>
        <Field label="Notas / observaciones"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="input resize-none" placeholder="Algo puntual para dejar anotado..." /></Field>
      </Card>

      {error && <p className="text-rose-400 text-xs text-center mb-3 bg-rose-500/10 rounded-lg py-2 px-3">{error}</p>}

      <button
        onClick={submitTurno} disabled={saving}
        className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 disabled:opacity-60 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 mt-2 shadow-xl shadow-indigo-950/50"
      >
        <Save size={16} /> {saving ? "Guardando..." : "Cerrar turno"}
      </button>
    </div>
  );
}

function ListEditor({ items, setItems, addLabel, fields, wallets }) {
  function add() {
    const base = { id: uid() };
    fields.forEach((f) => (base[f.key] = f.type === "select" ? (f.key === "billetera" && wallets ? wallets[0] : f.options[0]) : ""));
    setItems([...items, base]);
  }
  function update(id, key, val) {
    setItems(items.map((it) => (it.id === id ? { ...it, [key]: val } : it)));
  }
  return (
    <div>
      {items.map((it) => (
        <div key={it.id} className="grid gap-1.5 mb-2 items-center" style={{ gridTemplateColumns: `repeat(${fields.length}, 1fr) auto` }}>
          {fields.map((f) =>
            f.type === "select" ? (
              <select key={f.key} value={it[f.key]} onChange={(e) => update(it.id, f.key, e.target.value)} className="input !py-1.5 text-xs">
                {(f.key === "billetera" && wallets ? wallets : f.options).map((o) => (<option key={o}>{o}</option>))}
              </select>
            ) : (
              <input key={f.key} inputMode={f.numeric ? "numeric" : "text"} placeholder={f.placeholder} value={it[f.key]} onChange={(e) => update(it.id, f.key, f.numeric ? formatMiles(e.target.value) : e.target.value)} className="input !py-1.5 text-xs" />
            )
          )}
          <button onClick={() => setItems(items.filter((x) => x.id !== it.id))} className="text-slate-600 hover:text-rose-400">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button onClick={add} className="add-btn"><Plus size={13} /> {addLabel}</button>
    </div>
  );
}
