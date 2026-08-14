import React, { useState } from "react";
import { Lock } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function EmployeePinGate({ onIdentify }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit(value) {
    setChecking(true);
    const { data, error } = await supabase.rpc("verify_employee_pin", { input_pin: value });
    setChecking(false);
    const match = !error && data && data[0];
    if (match) { onIdentify({ id: match.id, nombre: match.nombre }); setPin(""); setErr(false); }
    else { setErr(true); setPin(""); }
  }
  function press(d) {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setErr(false);
    if (next.length === 4) submit(next);
  }

  return (
    <div className="max-w-xs mx-auto mt-16 text-center pt-5">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-600/20 ring-1 ring-indigo-500/30 flex items-center justify-center mx-auto mb-4">
        <Lock size={20} className="text-indigo-300" />
      </div>
      <h2 className="font-bold text-lg mb-1">¿Quién sos?</h2>
      <p className="text-slate-500 text-xs mb-5">{checking ? "Verificando..." : "Ingresá tu PIN para empezar el turno"}</p>
      <div className="flex justify-center gap-2 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? "bg-indigo-400" : "bg-white/10"}`} />
        ))}
      </div>
      {err && <p className="text-rose-400 text-xs mb-3">PIN no reconocido</p>}
      <div className="grid grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
          d === "" ? <div key={i} /> : (
            <button
              key={i}
              disabled={checking}
              onClick={() => (d === "⌫" ? setPin(pin.slice(0, -1)) : press(d))}
              className="bg-white/5 ring-1 ring-white/10 rounded-xl py-3.5 text-lg font-bold text-slate-200 active:bg-white/10 disabled:opacity-50"
            >
              {d}
            </button>
          )
        )}
      </div>
    </div>
  );
}
