import React, { useState, useEffect } from "react";
import { X, Lock } from "lucide-react";
import { Card } from "./ui";
import { PLATFORMS, num, money, blankOp, seedOps, GROW_BATCH } from "./lib";
import { supabase } from "./supabaseClient";

export default function OperacionesTab({ draft }) {
  const { ops, setOps, mensajesEnviados, setMensajesEnviados, expected, otherOpenBy } = draft;
  const [clientesConocidos, setClientesConocidos] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clientes").select("identificador").order("created_at", { ascending: false }).limit(500);
      setClientesConocidos((data || []).map((c) => c.identificador));
    })();
  }, []);

  async function recordarCliente(id) {
    const v = (id || "").trim();
    if (!v || clientesConocidos.includes(v)) return;
    setClientesConocidos((prev) => [v, ...prev]);
    await supabase.from("clientes").upsert({ identificador: v }, { onConflict: "identificador" });
  }

  if (otherOpenBy) {
    return (
      <div className="pt-5">
        <Card icon={<Lock size={15} />} title="El turno ya está abierto" subtitle={`A cargo de ${otherOpenBy.nombre}`}>
          <p className="text-sm text-slate-300">
            Las operaciones se cargan desde la caja de <b>{otherOpenBy.nombre}</b>, que ya está activa. Pedile que las cargue él, o esperá a que cierre el turno.
          </p>
        </Card>
      </div>
    );
  }

  function updateOp(id, patch, index) {
    const next = ops.map((o) => (o.id === id ? { ...o, ...patch } : o));
    if ("monto" in patch && index === ops.length - 1 && patch.monto !== "") {
      for (let i = 0; i < GROW_BATCH; i++) next.push(blankOp());
    }
    setOps(next);
  }
  function removeOp(id) { setOps(ops.filter((o) => o.id !== id)); }
  function clearEmpty() { setOps(ops.filter((o) => o.monto !== "")); }

  const filledCount = ops.filter((o) => o.monto !== "").length;
  const ventasTotal = ops.filter((o) => o.monto !== "" && o.tipo === "carga").reduce((s, o) => s + num(o.monto), 0);

  return (
    <div className="pt-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-bold text-lg">Operaciones</h2>
          <p className="text-slate-500 text-[11px]">{filledCount} cargadas · ventas {money(ventasTotal)}</p>
        </div>
        <button onClick={clearEmpty} className="text-slate-500 text-[11px]">Ordenar filas vacías</button>
      </div>
      <p className="text-[10px] text-slate-600 mb-2.5">
        Atajos en el monto: <b className="text-slate-400">B/G</b> plataforma · <b className="text-slate-400">C/R</b> carga o retiro · <b className="text-slate-400">↑ ↓ Enter</b> cambiar de fila
      </p>

      <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-2.5 mb-2.5 sticky top-16 z-10 backdrop-blur">
        <div className="grid grid-cols-2 gap-2 mb-2">
          {PLATFORMS.map((p) => (
            <p key={p.key} className="text-[10px] text-indigo-300 font-bold text-center">
              {p.label} esperado ahora: {money(expected.stock[p.key])}
            </p>
          ))}
        </div>
        <Field label="Mensajes enviados este turno">
          <input inputMode="numeric" value={mensajesEnviados} onChange={(e) => setMensajesEnviados(e.target.value)} placeholder="0" className="input !py-1.5 text-xs" />
        </Field>
      </div>

      <div className="space-y-1.5">
        {ops.map((o, i) => (
          <OpRow key={o.id} o={o} index={i} onUpdate={(patch) => updateOp(o.id, patch, i)} onRemove={() => removeOp(o.id)} onClienteDone={recordarCliente} />
        ))}
      </div>
      <datalist id="clientes-list">
        {clientesConocidos.map((c) => (<option key={c} value={c} />))}
      </datalist>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[9px] text-slate-500 mb-0.5 font-semibold uppercase">{label}</span>
      {children}
    </label>
  );
}

function OpRow({ o, index, onUpdate, onRemove, onClienteDone }) {
  const hasData = o.monto !== "";
  function focusRow(i) {
    const next = document.querySelector(`[data-monto-idx="${i}"]`);
    if (next) { next.focus(); next.select && next.select(); }
  }
  function handleKeyDown(e) {
    // Atajos para cargar sin usar el mouse:
    // Enter / flecha abajo → fila siguiente, flecha arriba → fila anterior,
    // B/G → plataforma, C/R → tipo (carga/retiro).
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusRow(index + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); focusRow(Math.max(0, index - 1)); return; }
    const k = e.key.toLowerCase();
    if (k === "b" || k === "g") { e.preventDefault(); onUpdate({ plataforma: k.toUpperCase() }); return; }
    if (k === "c") { e.preventDefault(); onUpdate({ tipo: "carga" }); return; }
    if (k === "r") { e.preventDefault(); onUpdate({ tipo: "retiro" }); return; }
  }
  return (
    <div className="flex items-center gap-1.5 bg-white/[0.02] ring-1 ring-white/5 rounded-xl px-2 py-1.5">
      <div className="flex gap-0.5">
        {["B", "G"].map((p) => (
          <button key={p} onClick={() => onUpdate({ plataforma: p })} className={`w-6 h-6 rounded text-[10px] font-black ${o.plataforma === p ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-500"}`}>{p}</button>
        ))}
      </div>
      <div className="flex gap-0.5">
        {[["carga", "C"], ["retiro", "R"]].map(([t, l]) => (
          <button key={t} onClick={() => onUpdate({ tipo: t })} className={`w-6 h-6 rounded text-[10px] font-black ${o.tipo === t ? "bg-violet-500 text-white" : "bg-white/5 text-slate-500"}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <input
          inputMode="numeric" placeholder="Monto" value={o.monto}
          data-monto-idx={index}
          onChange={(e) => onUpdate({ monto: e.target.value })}
          onKeyDown={handleKeyDown}
          className="input !py-1.5 text-xs"
        />
      </div>
      <div className="w-14 flex-none">
        <input
          list="clientes-list" placeholder="Cliente" value={o.cliente || ""} maxLength={12}
          onChange={(e) => onUpdate({ cliente: e.target.value })}
          onBlur={(e) => onClienteDone(e.target.value)}
          className="input !py-1.5 text-xs !px-1.5 text-center"
        />
      </div>
      {o.tipo === "carga" && (
        <div className="flex-1 min-w-0">
          <input inputMode="numeric" placeholder="Bono fichas" value={o.bono} onChange={(e) => onUpdate({ bono: e.target.value })} className="input !py-1.5 text-xs" />
        </div>
      )}
      <div className="flex gap-0.5">
        {[["nuevo", "N"], ["derivado", "D"], ["lista", "L"]].map(([v, l]) => (
          <button key={v} onClick={() => onUpdate({ origen: o.origen === v ? null : v })} className={`w-6 h-6 rounded text-[9px] font-black ${o.origen === v ? "bg-emerald-500 text-white" : "bg-white/5 text-slate-500"}`}>{l}</button>
        ))}
      </div>
      {hasData && (
        <button onClick={onRemove} className="text-slate-700 hover:text-rose-400 flex-none"><X size={14} /></button>
      )}
    </div>
  );
}
