import React, { useState, useEffect } from "react";
import { Lock, Sparkles, X, ArrowLeft } from "lucide-react";
import { supabase } from "./supabaseClient";
import { useTurnoDraft } from "./useTurnoDraft";
import { ADMIN_PIN } from "./lib";
import EmployeePinGate from "./EmployeePinGate";
import TurnoForm from "./TurnoForm";
import OperacionesTab from "./OperacionesTab";
import BasesView from "./BasesView";
import AdminDashboard from "./AdminDashboard";

export default function App() {
  const [view, setView] = useState("turno"); // turno | operaciones | bases | adminGate | admin
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [identity, setIdentity] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: wal } = await supabase.from("wallets").select("*").order("orden");
      setWallets((wal || []).map((w) => w.nombre));
      const { data: emp } = await supabase.from("employees").select("*").eq("activo", true);
      setEmployees(emp || []);
    })();
  }, []);

  const draft = useTurnoDraft(identity);

  function logout() { setIdentity(null); setView("turno"); }

  // Al cerrar el turno, se termina la sesión del empleado para que el próximo entre con su PIN.
  async function handleSubmit() {
    const ok = await draft.submitTurno();
    if (ok) setIdentity(null);
    return ok;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-indigo-950/40 to-transparent" />
      <TopBar view={view} setView={setView} opsCount={draft.opsFilledCount} identity={identity} onLogout={logout} />
      <div className="max-w-5xl mx-auto px-4 pb-24 relative">
        {view === "turno" && (identity ? <TurnoForm wallets={wallets} draft={{ ...draft, submitTurno: handleSubmit }} identity={identity} goOps={() => setView("operaciones")} /> : <EmployeePinGate employees={employees} onIdentify={setIdentity} />)}
        {view === "operaciones" && (identity ? <OperacionesTab draft={draft} /> : <EmployeePinGate employees={employees} onIdentify={setIdentity} />)}
        {view === "bases" && (identity ? <BasesView identity={identity} /> : <EmployeePinGate employees={employees} onIdentify={setIdentity} />)}
        {view === "adminGate" && (
          <PinGate
            pinInput={pinInput} setPinInput={setPinInput} pinError={pinError}
            onSubmit={() => { if (pinInput === ADMIN_PIN) { setView("admin"); setPinError(false); setPinInput(""); } else setPinError(true); }}
            onBack={() => setView("turno")}
          />
        )}
        {view === "admin" && <AdminDashboard onExit={() => setView("turno")} />}
      </div>
    </div>
  );
}

function TopBar({ view, setView, opsCount, identity, onLogout }) {
  const tabs = [
    { key: "turno", label: "Turno" },
    { key: "operaciones", label: "Operaciones", badge: opsCount },
    { key: "bases", label: "Bases" },
    { key: "admin", label: "Admin", icon: <Lock size={11} /> },
  ];
  return (
    <div className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur-md border-b border-white/5">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-none">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-950/50">
            <Sparkles size={15} className="text-white" />
          </div>
          {identity && (
            <button onClick={onLogout} className="hidden sm:flex items-center gap-1 bg-white/5 ring-1 ring-white/10 rounded-full px-2.5 py-1 text-[10px] font-bold text-slate-300">
              {identity.nombre} <X size={10} className="text-slate-500" />
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-white/5 rounded-full p-1 text-xs font-bold ring-1 ring-white/5 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.key === "admin" ? view === "admin" || view === "adminGate" : view === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setView(t.key === "admin" ? (view === "admin" ? "admin" : "adminGate") : t.key)}
                className={`px-3 py-1.5 rounded-full transition flex items-center gap-1 flex-none ${active ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow shadow-indigo-950/50" : "text-slate-400"}`}
              >
                {t.icon} {t.label}
                {t.badge > 0 && <span className="bg-black/30 rounded-full px-1.5 text-[9px]">{t.badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PinGate({ pinInput, setPinInput, pinError, onSubmit, onBack }) {
  return (
    <div className="max-w-xs mx-auto mt-20 text-center pt-5">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-600/20 ring-1 ring-indigo-500/30 flex items-center justify-center mx-auto mb-4">
        <Lock size={20} className="text-indigo-300" />
      </div>
      <h2 className="font-bold text-lg mb-1">Acceso admin</h2>
      <p className="text-slate-500 text-xs mb-5">Ingresá el PIN para ver el panel de control</p>
      <input
        type="password" inputMode="numeric" value={pinInput}
        onChange={(e) => setPinInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        className="w-full text-center tracking-[0.5em] text-xl bg-white/5 ring-1 ring-white/10 rounded-xl py-3 mb-3 focus:outline-none focus:ring-indigo-500"
        placeholder="••••" maxLength={4} autoFocus
      />
      {pinError && <p className="text-rose-400 text-xs mb-3">PIN incorrecto</p>}
      <button onClick={onSubmit} className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 font-bold py-2.5 rounded-xl text-sm mb-2">Entrar</button>
      <button onClick={onBack} className="text-slate-500 text-xs flex items-center gap-1 mx-auto mt-2"><ArrowLeft size={12} /> Volver</button>
    </div>
  );
}
