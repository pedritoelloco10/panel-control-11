import React, { useState, useEffect } from "react";
import { Database, Users, Plus, Sparkles, ChevronDown, Flame } from "lucide-react";
import { Card } from "./ui";
import { todayStr, LEAD_STATES, MOTIVOS_DESCARTE } from "./lib";
import { supabase } from "./supabaseClient";

const BADGE_CLASSES = {
  slate: "bg-slate-500/15 text-slate-400",
  indigo: "bg-indigo-500/15 text-indigo-400",
  sky: "bg-sky-500/15 text-sky-400",
  amber: "bg-amber-500/15 text-amber-400",
  emerald: "bg-emerald-500/15 text-emerald-400",
  rose: "bg-rose-500/15 text-rose-400",
};
const ACTIVE_CLASSES = {
  slate: "bg-slate-500 text-white",
  indigo: "bg-indigo-500 text-white",
  sky: "bg-sky-500 text-white",
  amber: "bg-amber-500 text-white",
  emerald: "bg-emerald-500 text-white",
  rose: "bg-rose-500 text-white",
};
const ACTIVOS = ["nuevo", "contactado", "contestado", "interesado"];

export default function BasesView({ identity }) {
  const [contacts, setContacts] = useState([]);
  const [urgentes, setUrgentes] = useState([]);
  const [cupo, setCupo] = useState(35);
  const [refuerzo, setRefuerzo] = useState(null); // null = no es refuerzo, {inicio} = sí lo es
  const [savedMsg, setSavedMsg] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [discardingId, setDiscardingId] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => { load(); }, [identity]);

  async function load() {
    setLoading(true); setErrMsg("");

    const { data: status } = await supabase.rpc("session_my_status", { input_token: identity.token });
    const st = status && status[0];
    if (st) {
      setCupo(st.cupo);
      setRefuerzo(st.es_refuerzo ? { inicio: st.refuerzo_inicio } : null);
    }

    // Repartir + traer tus contactos de hoy: todo lo hace el servidor, validando
    // tu credencial de sesión — la app nunca toca la tabla de contactos directo.
    const { data, error } = await supabase.rpc("session_get_leads", { input_token: identity.token });
    if (error) { setErrMsg("Tu sesión venció, volvé a entrar con tu PIN."); setLoading(false); return; }
    setContacts((data || []).sort((a, b) => (a.estado === "nuevo" ? -1 : 1)));

    // La cola de urgentes es de todos — contactó y se está enfriando, lo ve
    // cualquiera con sesión válida, le toquen leads nuevos hoy o no.
    const { data: urg } = await supabase.rpc("session_urgent_queue", { input_token: identity.token });
    setUrgentes(urg || []);
    setLoading(false);
  }

  async function setEstado(c, estado, motivo) {
    const { error } = await supabase.rpc("session_set_estado", { input_token: identity.token, target_id: c.id, nuevo_estado: estado, motivo: motivo || null });
    if (!error) {
      const patch = { estado, motivo_descarte: estado === "descartado" ? motivo : null };
      setContacts(contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    }
    setDiscardingId(null);
  }

  async function setEstadoUrgente(c, estado, motivo) {
    const { error } = await supabase.rpc("session_claim_urgent", { input_token: identity.token, target_id: c.id, nuevo_estado: estado, motivo: motivo || null });
    if (!error) setUrgentes(urgentes.filter((x) => x.id !== c.id));
    setDiscardingId(null);
  }

  async function guardarRefuerzo() {
    await supabase.rpc("session_close_refuerzo", { input_token: identity.token });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
    load();
  }

  async function addContact() {
    if (!newName.trim()) return;
    const { data: newId, error } = await supabase.rpc("session_add_contact", { input_token: identity.token, nombre: newName.trim(), numero: newPhone.trim() });
    if (!error && newId) {
      setContacts([...contacts, { id: newId, nombre: newName.trim(), numero: newPhone.trim(), estado: "nuevo" }]);
      setNewName(""); setNewPhone("");
    }
  }

  const activos = contacts.filter((c) => ACTIVOS.includes(c.estado || "nuevo"));
  const resueltos = contacts.filter((c) => !ACTIVOS.includes(c.estado || "nuevo"));

  if (loading) return <p className="text-slate-500 text-sm text-center mt-16">Cargando tus contactos de hoy...</p>;

  return (
    <div className="pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-indigo-300" />
        <h2 className="font-bold text-lg">Bases de datos</h2>
      </div>

      {errMsg && (
        <Card icon={<Sparkles size={15} />} title="Sesión vencida" subtitle="Por seguridad, las sesiones vencen solas cada 14 horas">
          <p className="text-slate-500 text-xs">{errMsg} Salí y volvé a entrar con tu PIN desde la parte de arriba.</p>
        </Card>
      )}

      {!errMsg && (
        <>
          {refuerzo && (
            <Card icon={<Users size={15} />} title="Estás como refuerzo" subtitle={`Desde las ${new Date(refuerzo.inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}>
              <p className="text-slate-400 text-xs mb-2.5">Ya hay una caja principal abierta con otra persona — vos estás 100% en bases, con un cupo propio de {cupo} contactos.</p>
              <button onClick={guardarRefuerzo} className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 font-bold py-2 rounded-xl text-xs">
                {savedMsg ? "✓ Guardado" : "Guardar mi turno de refuerzo"}
              </button>
            </Card>
          )}
          {urgentes.length > 0 && (
            <Card
              icon={<Flame size={15} className="text-rose-400" />} title="Urgentes — se están enfriando"
              subtitle="Contestaron hace 2+ horas y siguen sin cerrar. Es para cualquiera, no hace falta que sean tuyos."
            >
              <div className="space-y-2">
                {urgentes.map((c) => {
                  const st = LEAD_STATES.find((s) => s.key === (c.estado || "contestado")) || LEAD_STATES[0];
                  return (
                    <div key={c.id} className="bg-rose-500/10 ring-1 ring-rose-500/30 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-xs truncate">{c.nombre}</p>
                          <p className="text-slate-500 text-[10px]">{c.numero || "sin número"}</p>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-none ${BADGE_CLASSES[st.color]}`}>{st.label}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => setEstadoUrgente(c, "cargado")} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500 text-white">Cargó</button>
                        <button onClick={() => setEstadoUrgente(c, "interesado")} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500 text-white">Sigue interesado</button>
                        <button
                          onClick={() => setDiscardingId(discardingId === "u" + c.id ? null : "u" + c.id)}
                          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/10 text-slate-300 flex items-center gap-0.5"
                        >
                          Descartar <ChevronDown size={10} />
                        </button>
                      </div>
                      {discardingId === "u" + c.id && (
                        <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-white/10">
                          {MOTIVOS_DESCARTE.map((m) => (
                            <button key={m} onClick={() => setEstadoUrgente(c, "descartado", m)} className="text-[9px] bg-white/10 text-slate-300 px-2 py-1 rounded-lg">
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          <div className="bg-indigo-500/10 ring-1 ring-indigo-500/30 rounded-xl px-3.5 py-3 mb-4 flex items-center gap-2.5">
            <Sparkles size={16} className="text-indigo-300 flex-none" />
            <p className="text-xs text-slate-300">
              <span className="font-bold text-indigo-300">Hoy te tocan {contacts.length} de {cupo}</span> — {activos.length} pendientes, {resueltos.length} ya resueltos.
            </p>
          </div>

          {contacts.length === 0 ? (
            <Card icon={<Sparkles size={15} />} title="No hay contactos disponibles" subtitle="La base compartida está vacía por ahora">
              <p className="text-slate-500 text-xs">Pedile al admin que cargue contactos nuevos, o esperá a que se libere alguno.</p>
            </Card>
          ) : (
            <Card icon={<Users size={15} />} title="Tus contactos de hoy" subtitle={`${activos.length} pendientes`}>
              <div className="max-h-[32rem] overflow-y-auto mb-3 -mx-1 px-1 space-y-2">
                {[...activos, ...resueltos].map((c) => {
                  const estado = c.estado || "nuevo";
                  const st = LEAD_STATES.find((s) => s.key === estado) || LEAD_STATES[0];
                  return (
                    <div key={c.id} className="bg-white/[0.02] ring-1 ring-white/5 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-xs truncate">{c.nombre}</p>
                          <p className="text-slate-500 text-[10px]">{c.numero || "sin número"}</p>
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-none ${BADGE_CLASSES[st.color]}`}>{st.label}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {LEAD_STATES.filter((s) => s.key !== "descartado").map((s) => (
                          <button
                            key={s.key} onClick={() => setEstado(c, s.key)}
                            className={`text-[10px] font-bold px-2 py-1 rounded-lg ${estado === s.key ? ACTIVE_CLASSES[s.color] : "bg-white/5 text-slate-500"}`}
                          >
                            {s.label}
                          </button>
                        ))}
                        <button
                          onClick={() => setDiscardingId(discardingId === c.id ? null : c.id)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-0.5 ${estado === "descartado" ? "bg-rose-500 text-white" : "bg-white/5 text-slate-500"}`}
                        >
                          Descartar <ChevronDown size={10} />
                        </button>
                      </div>
                      {discardingId === c.id && (
                        <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-white/5">
                          {MOTIVOS_DESCARTE.map((m) => (
                            <button key={m} onClick={() => setEstado(c, "descartado", m)} className="text-[9px] bg-rose-500/10 text-rose-400 px-2 py-1 rounded-lg">
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                      {estado === "descartado" && c.motivo_descarte && (
                        <p className="text-[9px] text-rose-400/80 mt-1.5">Motivo: {c.motivo_descarte}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-500 font-semibold mb-1.5">Agregar un contacto nuevo (se te asigna directo a vos)</p>
              <div className="grid grid-cols-7 gap-1.5">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre" className="input col-span-3 !py-1.5 text-xs" />
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Número" className="input col-span-3 !py-1.5 text-xs" />
                <button onClick={addContact} className="col-span-1 bg-white/5 ring-1 ring-white/10 rounded-lg flex items-center justify-center">
                  <Plus size={14} />
                </button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
