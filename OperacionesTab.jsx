import React, { useState, useEffect } from "react";
import { X, Lock, WifiOff } from "lucide-react";
import { Card } from "./ui";
import { PLATFORMS, num, money, formatMiles, blankOp, seedOps, GROW_BATCH } from "./lib";
import { supabase } from "./supabaseClient";

export default function OperacionesTab({ draft }) {
  const { ops, setOps, expected, otherOpenBy, autosaveError } = draft;
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
    setOps((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, ...patch } : o));
      if ("monto" in patch && index === prev.length - 1 && patch.monto !== "") {
        for (let i = 0; i < GROW_BATCH; i++) next.push(blankOp());
      }
      return next;
    });
  }
  function removeOp(id) { setOps((prev) => prev.filter((o) => o.id !== id)); }
  function clearEmpty() { setOps((prev) => prev.filter((o) => o.monto !== "")); }

  const filledCount = ops.filter((o) => o.monto !== "").length;
  const ventasTotal = ops.filter((o) => o.monto !== "" && o.tipo === "carga").reduce((s, o) => s + num(o.monto), 0);

  return (
    <div className="pt-5">
      {autosaveError && (
        <div className="bg-rose-500/15 ring-1 ring-rose-500/40 rounded-xl px-3.5 py-2.5 mb-3 flex items-center gap-2">
          <WifiOff size={15} className="text-rose-400 flex-none" />
          <p className="text-xs text-rose-300 font-bold">
            No se pudo guardar el último cambio — revisá tu conexión. Sigue reintentando solo, no cierres la pestaña hasta que este aviso desaparezca.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-bold text-lg">Operaciones</h2>
          <p className="text-slate-500 text-[11px]">{filledCount} cargadas · ventas {money(ventasTotal)}</p>
        </div>
        <button onClick={clearEmpty} className="text-slate-500 text-[11px]">Ordenar filas vacías</button>
      </div>
      <p className="text-[10px] text-slate-600 mb-2.5">
        Atajos: <b className="text-slate-400">B/G</b> plataforma · <b className="text-slate-400">C/R</b> carga o retiro · <b className="text-slate-400">← →</b> monto/bono/cliente · <b className="text-slate-400">↑ ↓ Enter</b> cambiar de fila
      </p>

      <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-2.5 mb-2.5 sticky top-16 z-10 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((p) => (
            <p key={p.key} className="text-[10px] text-indigo-300 font-bold text-center">
              {p.label} esperado ahora: {money(expected.stock[p.key])}
            </p>
          ))}
        </div>
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

function focusField(row, field) {
  let el = document.querySelector(`[data-row="${row}"][data-field="${field}"]`);
  if (!el) el = document.querySelector(`[data-row="${row}"][data-field="monto"]`); // fallback si ese campo no existe en esa fila (ej: bono en un retiro)
  if (el) { el.focus(); el.select && el.select(); }
}

function OpRow({ o, index, onUpdate, onRemove, onClienteDone }) {
  const hasData = o.monto !== "";
  const esCarga = o.tipo === "carga";

  function makeKeyDown(field) {
    return (e) => {
      // Flechas arriba/abajo y Enter: mismo campo, fila siguiente o anterior.
      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusField(index + 1, field); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); focusField(Math.max(0, index - 1), field); return; }
      // Flechas izquierda/derecha: se mueve entre monto → bono → cliente, dentro de la misma fila.
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (field === "monto") focusField(index, esCarga ? "bono" : "cliente");
        else if (field === "bono") focusField(index, "cliente");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (field === "cliente") focusField(index, esCarga ? "bono" : "monto");
        else if (field === "bono") focusField(index, "monto");
        return;
      }
      // Atajos de letra, solo tienen sentido parado en el monto (para no interferir con escribir el número de cliente).
      if (field === "monto") {
        const k = e.key.toLowerCase();
        if (k === "b" || k === "g") { e.preventDefault(); onUpdate({ plataforma: k.toUpperCase() }); return; }
        if (k === "c") { e.preventDefault(); onUpdate({ tipo: "carga" }); return; }
        if (k === "r") { e.preventDefault(); onUpdate({ tipo: "retiro" }); return; }
      }
    };
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
          data-row={index} data-field="monto"
          onChange={(e) => onUpdate({ monto: formatMiles(e.target.value) })}
          onKeyDown={makeKeyDown("monto")}
          className="input !py-1.5 text-xs"
        />
      </div>
      {esCarga && (
        <div className="flex-1 min-w-0">
          <input
            inputMode="numeric" placeholder="Bono fichas" value={o.bono}
            data-row={index} data-field="bono"
            onChange={(e) => onUpdate({ bono: formatMiles(e.target.value) })}
            onKeyDown={makeKeyDown("bono")}
            className="input !py-1.5 text-xs"
          />
        </div>
      )}
      <div className="w-14 flex-none">
        <input
          list="clientes-list" placeholder="Cliente" value={o.cliente || ""} maxLength={12}
          data-row={index} data-field="cliente"
          onChange={(e) => onUpdate({ cliente: e.target.value })}
          onKeyDown={makeKeyDown("cliente")}
          onBlur={(e) => onClienteDone(e.target.value)}
          className="input !py-1.5 text-xs !px-1.5 text-center"
        />
      </div>
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
