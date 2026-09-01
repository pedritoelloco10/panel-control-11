import React from "react";
import { Users, Wallet, Coins, ListChecks, ChevronRight, TrendingUp, CheckCircle2, Save, Trash2, Plus, Lock } from "lucide-react";
import { Card, Field, Badge } from "./ui";
import { PLATFORMS, num, money, classifyTurno, uid } from "./lib";

export default function TurnoForm({ wallets, draft, identity, goOps }) {
  const { meta, setMeta, billInicio, billCierre, setBillCierre,
    stockInicio, stockCierreInf, setStockCierreInf,
    bajadas, setBajadas, movs, setMovs, notas, setNotas,
    expected, cierreCheck, saving, error, saved, submitTurno, opsFilledCount, carriedFrom, otherOpenBy, refuerzoPropioAbierto } = draft;

  if (refuerzoPropioAbierto) {
    return (
      <div className="pt-5">
        <Card icon={<Lock size={15} />} title="Estás trabajando como refuerzo" subtitle="No podés abrir una caja mientras tanto">
          <p className="text-sm text-slate-300 mb-2">
            Tenés tu sesión de refuerzo abierta en <b>Bases</b>. Mientras siga así, no podés abrir Turno — aunque en este momento no haya ninguna otra caja abierta.
          </p>
          <p className="text-sm text-slate-400">
            Si terminaste de trabajar como refuerzo, andá a <b>Bases</b> y tocá <b>"Cerrar sesión"</b>. Si en cambio necesitás tomar la caja porque nadie más va a abrirla, avisale a tu encargado primero.
          </p>
        </Card>
      </div>
    );
  }

  if (otherOpenBy) {
    return (
      <div className="pt-5">
        <Card icon={<Lock size={15} />} title="El turno ya está abierto" subtitle={`A cargo de ${otherOpenBy.nombre}`}>
          <p className="text-sm text-slate-300 mb-2">
            <b>{otherOpenBy.nombre}</b> ya tiene la caja abierta desde las {otherOpenBy.hora?.slice(0, 5)}. Para que la plata no quede pisada por dos personas a la vez, no se abre otra caja mientras esta siga activa.
          </p>
          <p className="text-sm text-slate-400">
            Podés seguir trabajando desde la pestaña <b>Bases</b> normalmente — eso no depende del turno. Cuando {otherOpenBy.nombre} cierre, avisale que anote el saldo final de las billeteras antes de cerrar.
          </p>
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

      <Card icon={<Users size={15} />} title="Datos del turno" subtitle={`Operando como ${identity?.nombre || "—"}`}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Field label="Fecha">
            <input type="date" value={meta.fecha} onChange={(e) => setMeta({ ...meta, fecha: e.target.value })} className="input" />
          </Field>
          <Field label="Hora de inicio">
            <input type="time" value={meta.horaInicio} onChange={(e) => setMeta({ ...meta, horaInicio: e.target.value })} className="input" />
          </Field>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">Franja detectada: {classifyTurno(meta.horaInicio)}</p>
      </Card>

      <Card icon={<Wallet size={15} />} title="Billeteras — inicio" subtitle={carriedFrom ? `Arrastrado del cierre de ${carriedFrom.responsable} · ${carriedFrom.fecha} ${carriedFrom.hora}` : "Primer turno cargado — sin cierre anterior"}>
        <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto -mx-1 px-1">
          {wallets.map((w) => (
            <div key={w} className="bg-black/20 rounded-lg px-2.5 py-2">
              <p className="text-[9px] text-slate-500 uppercase mb-0.5">{w}</p>
              <p className="text-sm font-bold">{money(num(billInicio[w] || 0))}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<Coins size={15} />} title="Stock de fichas — inicio" right={<span className="text-[10px] text-slate-500">arrastrado, bloqueado</span>}>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((p) => (
            <div key={p.key}>
              <p className="text-[10px] text-slate-500 uppercase mb-1">{p.label} — inicio</p>
              <p className="text-sm font-bold bg-black/20 rounded-lg px-2.5 py-2">{money(num(stockInicio[p.key] || 0))}</p>
              <p className="text-[10px] text-indigo-300 font-bold mt-1">Esperado ahora: {money(expected.stock[p.key])}</p>
            </div>
          ))}
        </div>
      </Card>

      <button onClick={goOps} className="w-full bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-4 mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-indigo-300"><ListChecks size={15} /></span>
          <div className="text-left">
            <p className="font-bold text-sm">Registro de operaciones</p>
            <p className="text-slate-500 text-[11px]">{opsFilledCount} cargadas — se hace en la pestaña "Operaciones"</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-slate-500" />
      </button>

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
                inputMode="numeric" value={billCierre[w] || ""}
                data-cierre-idx={i}
                onChange={(e) => setBillCierre({ ...billCierre, [w]: e.target.value.replace(/[^\d]/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = document.querySelector(`[data-cierre-idx="${i + 1}"]`);
                    if (next) { next.focus(); next.select && next.select(); }
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prev = document.querySelector(`[data-cierre-idx="${Math.max(0, i - 1)}"]`);
                    if (prev) { prev.focus(); prev.select && prev.select(); }
                  }
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
                inputMode="numeric" value={stockCierreInf[p.key]}
                data-ficha-idx={i}
                onChange={(e) => setStockCierreInf({ ...stockCierreInf, [p.key]: e.target.value.replace(/[^\d]/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const next = document.querySelector(`[data-ficha-idx="${i + 1}"]`);
                    if (next) { next.focus(); next.select && next.select(); }
                  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const prev = document.querySelector(`[data-ficha-idx="${Math.max(0, i - 1)}"]`);
                    if (prev) { prev.focus(); prev.select && prev.select(); }
                  }
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
        </Card>
      )}

      <Card icon={<Users size={15} />} title="Cierre">
        <Field label="Hora de fin">
          <input type="time" value={meta.horaFin} onChange={(e) => setMeta({ ...meta, horaFin: e.target.value })} className="input mb-3" />
        </Field>
        <Field label="Notas / observaciones">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className="input resize-none" placeholder="Algo puntual para dejar anotado..." />
        </Field>
      </Card>

      {error && <p className="text-rose-400 text-xs text-center mb-3 bg-rose-500/10 rounded-lg py-2 px-3">{error}</p>}

      <button
        onClick={submitTurno} disabled={saving}
        className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 disabled:opacity-60 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 mt-2 shadow-xl shadow-indigo-950/50"
      >
        <Save size={16} /> {saving ? "Guardando..." : "Guardar turno"}
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
              <input key={f.key} inputMode={f.numeric ? "numeric" : "text"} placeholder={f.placeholder} value={it[f.key]} onChange={(e) => update(it.id, f.key, e.target.value)} className="input !py-1.5 text-xs" />
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
