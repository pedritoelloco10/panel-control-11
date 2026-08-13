import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export function Card({ icon, title, subtitle, children, right }) {
  return (
    <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-4 mb-3 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-indigo-300 flex-none">{icon}</span>
          <div>
            <h3 className="font-bold text-sm">{title}</h3>
            {subtitle && <p className="text-slate-500 text-[11px]">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-1 font-semibold uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

export function Pill({ active, children, onClick, tone = "indigo" }) {
  const tones = { indigo: "from-indigo-500 to-violet-600", emerald: "from-emerald-500 to-teal-500", rose: "from-rose-500 to-pink-600", amber: "from-amber-500 to-orange-500" };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${active ? `bg-gradient-to-r ${tones[tone]} text-white shadow shadow-black/30` : "bg-white/5 text-slate-400 ring-1 ring-white/5"}`}>
      {children}
    </button>
  );
}

export function Badge({ ok, textBad, children }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${ok ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
      {ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {children || (ok ? "Coincide" : textBad)}
    </span>
  );
}

export function StatBox({ label, value, positive, negative }) {
  return (
    <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-3">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <p className={`font-black text-lg ${negative ? "text-rose-400" : positive ? "text-emerald-400" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}

export function MiniStat({ label, value, pct }) {
  return (
    <div>
      <p className="text-xl font-black">{value}</p>
      <p className="text-[9px] text-slate-500">{label}</p>
      {pct !== undefined && <p className="text-[9px] text-indigo-300 font-bold">{pct}%</p>}
    </div>
  );
}
