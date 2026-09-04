import React, { useState, useEffect } from "react";
import { Database, Users, Plus, Sparkles, ChevronDown, Flame, Clock, Pause, Play, History, StickyNote, Check } from "lucide-react";
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
  orange: "bg-orange-500/15 text-orange-400",
};
const ACTIVE_CLASSES = {
  slate: "bg-slate-500 text-white",
  indigo: "bg-indigo-500 text-white",
  sky: "bg-sky-500 text-white",
  amber: "bg-amber-500 text-white",
  emerald: "bg-emerald-500 text-white",
  rose: "bg-rose-500 text-white",
  orange: "bg-orange-500 text-white",
};
// "para_retomar" cuenta como pendiente — es un contacto que ya se trabajó
// antes y volvió al pool, no algo resuelto.
const ACTIVOS = ["nuevo", "contactado", "contestado", "interesado", "para_retomar"];

export default function BasesView({ identity, onLogout }) {
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
  // Aviso puntual (no bloqueante) cuando un contacto ya no está asignado a vos —
  // por ejemplo, porque el sistema lo reasignó a otra persona mientras lo tenías
  // abierto. Antes esto pasaba en silencio y el empleado creía que había guardado.
  const [warnMsg, setWarnMsg] = useState("");
  // Qué tarjeta de contacto tiene el panel "Más" abierto (pausar, recordatorio,
  // historial, notas) — solo una a la vez, para no saturar la pantalla.
  const [expandedId, setExpandedId] = useState(null);
  const [notaDrafts, setNotaDrafts] = useState({});
  const [reminders, setReminders] = useState([]);
  const [historyFor, setHistoryFor] = useState(null);
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

    const { data: rec } = await supabase.rpc("session_list_reminders_pendientes", { input_token: identity.token });
    setReminders(rec || []);

    setLoading(false);
  }

  async function setEstado(c, estado, motivo) {
    setWarnMsg("");
    const { data: guardado, error } = await supabase.rpc("session_set_estado", { input_token: identity.token, target_id: c.id, nuevo_estado: estado, motivo: motivo || null });
    if (error) {
      setWarnMsg("No se pudo guardar por un error de conexión. Probá de nuevo.");
    } else if (guardado === false) {
      // La función respondió sin error, pero avisó que NO tocó nada: este contacto
      // ya no está asignado a vos (probablemente se reasignó). Antes esto se
      // ignoraba y quedaba como "guardado" en tu pantalla sin serlo de verdad.
      setWarnMsg(`"${c.nombre}" ya no está asignado a vos — puede que se haya reasignado. Se actualizó tu lista.`);
      load();
    } else {
      const patch = { estado, motivo_descarte: estado === "descartado" ? motivo : null };
      setContacts(contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    }
    setDiscardingId(null);
  }

  async function setEstadoUrgente(c, estado, motivo) {
    setWarnMsg("");
    const { data: guardado, error } = await supabase.rpc("session_claim_urgent", { input_token: identity.token, target_id: c.id, nuevo_estado: estado, motivo: motivo || null });
    if (error) {
      setWarnMsg("No se pudo guardar por un error de conexión. Probá de nuevo.");
    } else if (guardado === false) {
      setWarnMsg(`"${c.nombre}" ya lo tomó otra persona de la cola de urgentes. Se actualizó tu lista.`);
      load();
    } else {
      setUrgentes(urgentes.filter((x) => x.id !== c.id));
    }
    setDiscardingId(null);
  }

  async function cerrarSesion() {
    // Cierra la sesión de verdad en el servidor (y el turno de refuerzo si
    // estaba abierto) antes de sacar a la persona a la pantalla de PIN.
    const { error } = await supabase.rpc("session_logout", { input_token: identity.token });
    if (error) { alert("No se pudo cerrar la sesión: " + error.message); return; }
    onLogout();
  }

  async function addContact() {
    if (!newName.trim()) return;
    const { data: newId, error } = await supabase.rpc("session_add_contact", { input_token: identity.token, nombre: newName.trim(), numero: newPhone.trim() });
    if (!error && newId) {
      setContacts([...contacts, { id: newId, nombre: newName.trim(), numero: newPhone.trim(), estado: "nuevo" }]);
      setNewName(""); setNewPhone("");
    }
  }

  async function togglePausado(c) {
    setWarnMsg("");
    const pausando = !c.pausado;
    const motivo = pausando ? (window.prompt("Motivo de la pausa (opcional):") || null) : null;
    const { data: ok, error } = await supabase.rpc("session_toggle_pausado", {
      input_token: identity.token, target_id: c.id, nuevo_pausado: pausando, motivo,
    });
    if (error || ok === false) {
      setWarnMsg("No se pudo actualizar la pausa. Probá de nuevo.");
      return;
    }
    setContacts(contacts.map((x) => (x.id === c.id ? { ...x, pausado: pausando, motivo_pausa: motivo } : x)));
  }

  async function saveNota(c, texto) {
    if ((c.notas || "") === texto) return;
    const { error } = await supabase.rpc("session_set_nota", { input_token: identity.token, target_id: c.id, nueva_nota: texto });
    if (error) { setWarnMsg("No se pudo guardar la nota. Probá de nuevo."); return; }
    setContacts(contacts.map((x) => (x.id === c.id ? { ...x, notas: texto } : x)));
  }

  async function crearRecordatorio(c, dias) {
    const nota = window.prompt("Nota para el recordatorio (opcional):") || null;
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    const { error } = await supabase.rpc("session_add_reminder", {
      input_token: identity.token, target_id: c.id, recordar_en: fecha.toISOString(), nota,
    });
    if (error) { setWarnMsg("No se pudo crear el recordatorio. Probá de nuevo."); return; }
    const { data: rec } = await supabase.rpc("session_list_reminders_pendientes", { input_token: identity.token });
    setReminders(rec || []);
  }

  async function completarRecordatorio(r) {
    const { data: ok, error } = await supabase.rpc("session_complete_reminder", { input_token: identity.token, target_id: r.id });
    if (error || ok === false) { setWarnMsg("No se pudo marcar el recordatorio como listo."); return; }
    setReminders(reminders.filter((x) => x.id !== r.id));
  }

  async function verHistorial(c) {
    if (historyFor === c.id) { setHistoryFor(null); return; }
    setHistoryFor(c.id); setHistoryLoading(true);
    const { data, error } = await supabase.rpc("session_get_contact_events", { input_token: identity.token, target_id: c.id });
    setHistoryLoading(false);
    if (error) { setWarnMsg("No se pudo cargar el historial. Probá de nuevo."); setHistoryFor(null); return; }
    setHistoryEvents(data || []);
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

      {warnMsg && (
        <div className="bg-amber-500/10 ring-1 ring-amber-500/30 rounded-xl px-3.5 py-2.5 mb-3">
          <p className="text-amber-300 text-xs">{warnMsg}</p>
        </div>
      )}

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
              <button onClick={cerrarSesion} className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 font-bold py-2 rounded-xl text-xs">
                Cerrar sesión
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
          {reminders.length > 0 && (
            <Card icon={<Clock size={15} className="text-indigo-300" />} title="Tus recordatorios" subtitle="Vos mismo pediste que te avisen">
              <div className="space-y-2">
                {reminders.map((r) => (
                  <div key={r.id} className="bg-indigo-500/10 ring-1 ring-indigo-500/30 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-xs truncate">{r.contacto_nombre}</p>
                      <p className="text-slate-500 text-[10px] truncate">{r.base_nombre}{r.nota ? ` · ${r.nota}` : ""}</p>
                    </div>
                    <button onClick={() => completarRecordatorio(r)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-500 text-white flex items-center gap-1 flex-none">
                      <Check size={11} /> Listo
                    </button>
                  </div>
                ))}
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
                      {estado === "para_retomar" && c.ultimo_evento_resumen && (
                        <div className="bg-orange-500/10 ring-1 ring-orange-500/30 rounded-lg px-2.5 py-1.5 mb-2">
                          <p className="text-orange-300 text-[10px]">Ya se trabajó antes: {c.ultimo_evento_resumen}</p>
                        </div>
                      )}
                      {c.pausado && (
                        <div className="bg-slate-500/10 ring-1 ring-slate-500/30 rounded-lg px-2.5 py-1.5 mb-2">
                          <p className="text-slate-400 text-[10px]">Pausado{c.motivo_pausa ? `: ${c.motivo_pausa}` : ""}</p>
                        </div>
                      )}
                      <div className="flex gap-1 flex-wrap">
                        {LEAD_STATES.filter((s) => !["descartado", "para_retomar"].includes(s.key)).map((s) => (
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
                        <button
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-0.5 ${expandedId === c.id ? "bg-white/15 text-white" : "bg-white/5 text-slate-500"}`}
                        >
                          Más <ChevronDown size={10} />
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
                      {expandedId === c.id && (
                        <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
                          <div className="flex gap-1 flex-wrap">
                            <button
                              onClick={() => togglePausado(c)}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-300 flex items-center gap-1"
                            >
                              {c.pausado ? <Play size={10} /> : <Pause size={10} />} {c.pausado ? "Despausar" : "Pausar"}
                            </button>
                            <button onClick={() => crearRecordatorio(c, 1)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-300 flex items-center gap-1">
                              <Clock size={10} /> Mañana
                            </button>
                            <button onClick={() => crearRecordatorio(c, 3)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-300">
                              En 3 días
                            </button>
                            <button onClick={() => crearRecordatorio(c, 7)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-300">
                              En 7 días
                            </button>
                            <button
                              onClick={() => verHistorial(c)}
                              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-300 flex items-center gap-1"
                            >
                              <History size={10} /> Historial
                            </button>
                          </div>
                          {historyFor === c.id && (
                            <div className="bg-white/[0.02] ring-1 ring-white/5 rounded-lg px-2.5 py-2 space-y-1 max-h-40 overflow-y-auto">
                              {historyLoading ? (
                                <p className="text-slate-500 text-[10px]">Cargando...</p>
                              ) : historyEvents.length === 0 ? (
                                <p className="text-slate-500 text-[10px]">Sin eventos registrados.</p>
                              ) : (
                                historyEvents.map((ev) => (
                                  <p key={ev.id} className="text-[9px] text-slate-400">
                                    {new Date(ev.created_at).toLocaleString("es-AR")} · <span className="text-slate-300 font-semibold">{ev.empleado}</span> · {ev.accion}
                                  </p>
                                ))
                              )}
                            </div>
                          )}
                          <div>
                            <p className="text-[9px] text-slate-500 font-semibold mb-1 flex items-center gap-1"><StickyNote size={10} /> Nota</p>
                            <textarea
                              value={notaDrafts[c.id] ?? c.notas ?? ""}
                              onChange={(e) => setNotaDrafts({ ...notaDrafts, [c.id]: e.target.value })}
                              onBlur={(e) => saveNota(c, e.target.value)}
                              placeholder="Escribí algo y salí del campo para guardar..."
                              rows={2}
                              className="input w-full !py-1.5 text-[10px] resize-none"
                            />
                          </div>
                        </div>
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
