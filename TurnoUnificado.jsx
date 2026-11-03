import React, { useState, useEffect, useCallback } from "react";
import { Users, Wallet, Coins, TrendingUp, CheckCircle2, Save, Trash2, Plus, Lock, WifiOff, AlertTriangle, Megaphone } from "lucide-react";
import { Card, Field, Badge } from "./ui";
import { PLATFORMS, num, money, classifyTurno, uid, formatMiles } from "./lib";
import { supabase } from "./supabaseClient";

// Pantalla única para el empleado — reemplaza Turno + Operaciones por algo más liviano:
// el empleado ya no tipea plataforma/cliente/bono por operación de Ganamos (eso lo trae
// después la importación). Solo anota origen + monto cuando entra un cliente, y mientras
// dure Bet en paralelo, esas sí se cargan completas (carga/retiro) porque Ganamos nunca
// las va a traer solas.
//
// Todavía no está conectada en App.jsx a propósito — se activa recién cuando se decida.

const SEED_SLOTS = 5;
const GROW_SLOTS = 5;

// "fuente: rapido" es lo que distingue estos renglones de los 150 que useTurnoDraft
// arranca por default (seedOps, pensados para la grilla vieja de Operaciones, con
// plataforma "B" de por sí) — sin esta marca, esos 150 en blanco se confundirían con
// renglones de Bet acá.
function blankSlot() {
  return { id: uid(), fuente: "rapido", tipo: null, plataforma: null, origen: null, monto: "", hora: null };
}
function seedSlots(n) {
  return Array.from({ length: n }, blankSlot);
}

export default function TurnoUnificado({ wallets, draft, identity }) {
  const {
    ready, meta, setMeta, billInicio, billCierre, setBillCierre,
    stockInicio, stockCierreInf, setStockCierreInf,
    ops, setOps, bajadas, setBajadas, movs, setMovs, notas, setNotas,
    expected, cierreCheck, saving, error, saved, autosaveError, submitTurno,
    carriedFrom, otherOpenBy, refuerzoPropioAbierto, loadError,
  } = draft;

  // Mensajes de publicidad: mismo contador +/- que ya existe en Operaciones (RPCs
  // session_count_publicidad_hoy / session_add_publicidad_evento / session_remove_...),
  // se reusa tal cual en vez de inventar uno nuevo.
  const [pubHoy, setPubHoy] = useState(null);
  const [pubLoading, setPubLoading] = useState(false);
  const [pubError, setPubError] = useState(false);
  useEffect(() => {
    if (!identity?.token) return;
    supabase.rpc("session_count_publicidad_hoy", { input_token: identity.token }).then(({ data }) => setPubHoy(data ?? 0));
  }, [identity?.token]);
  async function addPublicidad() {
    if (pubLoading) return;
    setPubLoading(true); setPubError(false);
    const { data: ok, error: pubErr } = await supabase.rpc("session_add_publicidad_evento", { input_token: identity.token });
    if (pubErr || ok === false) setPubError(true); else setPubHoy((n) => (n ?? 0) + 1);
    setTimeout(() => setPubLoading(false), 500);
  }
  async function removePublicidad() {
    if (pubLoading) return;
    setPubLoading(true); setPubError(false);
    const { data: ok, error: pubErr } = await supabase.rpc("session_remove_publicidad_evento", { input_token: identity.token });
    if (pubErr) setPubError(true); else if (ok) setPubHoy((n) => Math.max(0, (n ?? 0) - 1));
    setTimeout(() => setPubLoading(false), 500);
  }

  // Grilla de carga rápida: 5 renglones, crecen de a 5 cuando se llena el último.
  // Cada renglón vive directo en `ops` (igual que la grilla vieja de Operaciones) para
  // no duplicar estado — se identifican por no tener ganamos_tx y ser tipo
  // "registro_rapido" (modo P/R/L) o plataforma "B" (modo Bet, temporal).
  const slots = (ops || []).filter((o) => o.fuente === "rapido");
  // Siempre tiene que quedar al menos un renglón en blanco para seguir cargando — esto
  // cubre tanto el turno recién abierto (sin ninguno todavía) como al retomar uno que ya
  // tenía cargas guardadas (los renglones en blanco nunca se guardan, solo los
  // completos, así que al recargar la página hay que volver a agregarlos).
  useEffect(() => {
    if (!ready) return;
    const sinLlenar = slots.filter((o) => o.monto === "").length;
    if (sinLlenar === 0) setOps((prev) => [...prev, ...seedSlots(SEED_SLOTS)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const updateSlot = useCallback((id, patch, indexEnSlots) => {
    setOps((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, ...patch } : o));
      if ("monto" in patch && indexEnSlots === slots.length - 1 && patch.monto !== "") {
        for (let i = 0; i < GROW_SLOTS; i++) next.push(blankSlot());
      }
      return next;
    });
  }, [setOps, slots.length]);
  const removeSlot = useCallback((id) => { setOps((prev) => prev.filter((o) => o.id !== id)); }, [setOps]);

  // Fichas de cierre de Ganamos: el empleado ya no las cuenta a mano — se completan
  // solas con lo que el sistema tiene calculado en vivo, y la verificación real la hace
  // el encargado después con la importación de Ganamos. Solo Bet se sigue informando a mano.
  useEffect(() => {
    const esperadoG = String(Math.round(expected.stock.G || 0));
    if (stockCierreInf.G !== esperadoG) setStockCierreInf((prev) => ({ ...prev, G: esperadoG }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expected.stock.G]);

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

      <Card icon={<Megaphone size={15} />} title="Mensajes de publicidad">
        <div className="flex items-center justify-between">
          <p className="text-3xl font-black text-indigo-300">
            {pubError ? "—" : pubHoy === null ? "…" : pubHoy}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={removePublicidad} disabled={pubLoading} className="w-11 h-11 rounded-xl bg-white/5 text-slate-300 disabled:opacity-60 font-black text-xl flex items-center justify-center">−</button>
            <button onClick={addPublicidad} disabled={pubLoading} className="w-11 h-11 rounded-xl bg-amber-500/20 text-amber-300 disabled:opacity-60 font-black text-xl flex items-center justify-center">+</button>
          </div>
        </div>
        {pubError && <p className="text-[10px] text-rose-400 mt-1">No se pudo actualizar — probá de nuevo.</p>}
      </Card>

      <Card icon={<Plus size={15} />} title="Cargas del turno" subtitle='Elegí P/R/L (Ganamos) o B (Bet) y poné el monto — la hora se pone sola'>
        <div className="space-y-1.5">
          {slots.map((o, i) => (
            <SlotRow key={o.id} o={o} index={i} total={slots.length} onUpdate={updateSlot} onRemove={removeSlot} />
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-2">B es temporal, mientras siga en uso Bet — todo lo demás de Ganamos entra solo con la importación.</p>
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
        <p className="hint mt-4">Compra de fichas</p>
        <ListEditor
          items={movs} setItems={setMovs} addLabel="Agregar compra"
          fields={[
            { key: "tipo", type: "select", options: ["Compra"], placeholder: "Tipo" },
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

      <Card icon={<Coins size={15} />} title="Stock de fichas — cierre">
        <Field label="BET — cierre (informado a mano)">
          <input
            inputMode="numeric" value={stockCierreInf.B}
            onChange={(e) => setStockCierreInf({ ...stockCierreInf, B: e.target.value.replace(/[^\d]/g, "") })}
            placeholder="0" className="input"
          />
        </Field>
        <Field label="GANA — saldo que ves ahora en Ganamos (opcional)">
          <input
            inputMode="numeric" value={stockCierreInf.G_reportado || ""}
            onChange={(e) => setStockCierreInf({ ...stockCierreInf, G_reportado: e.target.value.replace(/[^\d]/g, "") })}
            placeholder="0" className="input"
          />
        </Field>
        <p className="text-[10px] text-slate-600 mt-2">No hace falta que lo calcules ni que cierre con nada — solo copiá el número que ves en Ganamos en este momento, para que tu encargado lo tenga de referencia cuando haga la verificación real.</p>
      </Card>

      {cierreCheck.anyCierreData && (
        <Card icon={<CheckCircle2 size={15} />} title="Control de cierre" subtitle="Efectivo y fichas de Bet — lo único que contás vos">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-black/20 rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-slate-500 mb-1">Efectivo</p>
              <Badge ok={Math.abs(cierreCheck.diffEfectivo) < 1} textBad={`Dif. ${money(cierreCheck.diffEfectivo)}`} />
            </div>
            <div className="bg-black/20 rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-slate-500 mb-1">Fichas BET</p>
              <Badge ok={Math.abs(cierreCheck.diffFichas.B) < 1} textBad={`Dif. ${money(cierreCheck.diffFichas.B)}`} />
            </div>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">Las fichas de Ganamos las verifica tu encargado aparte, con el saldo real de la plataforma.</p>
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

const ORIGEN_LETRAS = [["nuevo", "P"], ["derivado", "R"], ["lista", "L"]];

const SlotRow = React.memo(function SlotRow({ o, index, total, onUpdate, onRemove }) {
  const hasData = o.monto !== "";
  const esBet = o.plataforma === "B";
  const patch = (p) => onUpdate(o.id, p, index);

  function elegirOrigen(v) {
    if (o.origen === v && o.tipo === "registro_rapido") { patch({ tipo: null, origen: null }); return; }
    patch({ tipo: "registro_rapido", origen: v, plataforma: null, hora: o.hora || new Date().toISOString() });
  }
  function elegirBet() {
    if (esBet) { patch({ tipo: null, plataforma: null, origen: null }); return; }
    patch({ tipo: "carga", plataforma: "B", origen: null, hora: o.hora || new Date().toISOString() });
  }
  function onMontoChange(v) {
    if (esBet) {
      const neg = v.trim().startsWith("-");
      const digits = v.replace(/[^\d]/g, "");
      patch({ monto: digits ? formatMiles(digits) : "", tipo: neg ? "retiro" : "carga" });
    } else {
      patch({ monto: formatMiles(v) });
    }
  }
  const montoMostrado = esBet && o.tipo === "retiro" && o.monto ? `-${o.monto}` : o.monto;
  const puedeTipear = o.tipo !== null;

  return (
    <div className="flex items-center gap-1.5 bg-white/[0.02] ring-1 ring-white/5 rounded-xl px-2 py-1.5">
      <div className="flex gap-0.5">
        {ORIGEN_LETRAS.map(([v, l]) => (
          <button key={v} onClick={() => elegirOrigen(v)} className={`w-9 h-9 rounded-lg text-xs font-black ${o.origen === v && o.tipo === "registro_rapido" ? "bg-emerald-500 text-white" : "bg-white/5 text-slate-400"}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <input
          inputMode="numeric" placeholder={puedeTipear ? "Monto" : "Elegí P/R/L o B"} value={montoMostrado}
          disabled={!puedeTipear}
          onChange={(e) => onMontoChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && index === total - 1 && o.monto !== "") document.activeElement.blur(); }}
          className="input !py-2 text-sm disabled:opacity-40"
        />
      </div>
      <button onClick={elegirBet} className={`w-9 h-9 rounded-lg text-xs font-black flex-none ${esBet ? "bg-amber-500 text-white" : "bg-white/5 text-slate-400"}`}>B</button>
      {hasData && (
        <button onClick={() => onRemove(o.id)} className="text-slate-700 hover:text-rose-400 flex-none"><Trash2 size={14} /></button>
      )}
    </div>
  );
});

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
