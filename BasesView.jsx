import React, { useState, useEffect } from "react";
import { Database, Users, Plus, Sparkles, ChevronDown } from "lucide-react";
import { Card } from "./ui";
import { todayStr, LEAD_STATES, MOTIVOS_DESCARTE, FUENTE_PRIORITY } from "./lib";
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
  const [cupo, setCupo] = useState(35);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [discardingId, setDiscardingId] = useState(null);

  useEffect(() => { load(); }, [identity]);

  async function load() {
    setLoading(true);
    const today = todayStr();

    const { data: cfg } = await supabase.from("app_config").select("value").eq("key", "cupo_diario_leads").single();
    const cupoDiario = cfg ? parseInt(cfg.value, 10) || 35 : 35;
    setCupo(cupoDiario);

    // Lo que ya tengo asignado hoy (haya avanzado o no).
    const { data: mine } = await supabase.from("contacts").select("*").eq("asignado_a", identity.nombre).eq("fecha_asignacion", today);
    let misContactos = mine || [];

    // ¿Cuántos me faltan para llegar al cupo del día? Solo cuentan los que
    // todavía están "en juego" (no cargados ni descartados).
    const activos = misContactos.filter((c) => ACTIVOS.includes(c.estado || "nuevo")).length;
    const faltan = cupoDiario - activos;

    if (faltan > 0) {
      setAssigning(true);
      const { data: dbs } = await supabase.from("databases").select("id, tipo_fuente");
      const prioridad = {}; (dbs || []).forEach((d) => { prioridad[d.id] = FUENTE_PRIORITY[d.tipo_fuente] ?? 1; });

      // Pool compartido: contactos sin trabajar, libres (nadie los tiene hoy).
      const { data: pool } = await supabase
        .from("contacts").select("*").in("estado", ["nuevo", "contactado"])
        .or(`asignado_a.is.null,fecha_asignacion.lt.${today}`)
        .order("created_at", { ascending: true })
        .limit(500);

      const ordenado = (pool || []).sort((a, b) => (prioridad[a.base_id] ?? 1) - (prioridad[b.base_id] ?? 1));
      const aTomar = ordenado.slice(0, faltan);

      if (aTomar.length > 0) {
        const ids = aTomar.map((c) => c.id);
        await supabase.from("contacts").update({ asignado_a: identity.nombre, fecha_asignacion: today }).in("id", ids);
        misContactos = [...misContactos, ...aTomar.map((c) => ({ ...c, asignado_a: identity.nombre, fecha_asignacion: today }))];
      }
      setAssigning(false);
    }

    setContacts(misContactos.sort((a, b) => (a.estado === "nuevo" ? -1 : 1)));
    setLoading(false);
  }

  async function logEvent(baseId, contactId, accion, detalle) {
    await supabase.from("contact_events").insert({ base_id: baseId, contact_id: contactId, empleado: identity.nombre, accion, detalle: detalle || {} });
  }

  async function setEstado(c, estado, motivo) {
    const patch = {
      estado, trabajada_por: identity.nombre, fecha_trabajo: todayStr(), ultimo_contacto: todayStr(),
      enviado: estado !== "nuevo", contestado: ["contestado", "interesado", "cargado"].includes(estado), cargo: estado === "cargado",
      motivo_descarte: estado === "descartado" ? motivo : null,
    };
    const { error } = await supabase.from("contacts").update(patch).eq("id", c.id);
    if (!error) {
      setContacts(contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
      logEvent(c.base_id, c.id, "estado:" + estado, motivo ? { motivo } : {});
    }
    setDiscardingId(null);
  }

  async function addContact() {
    if (!newName.trim()) return;
    // Se agrega directo a la primera base disponible marcada como "principales" o, si no hay, cualquiera.
    const { data: dbs } = await supabase.from("databases").select("id").order("created_at", { ascending: false }).limit(1);
    const baseId = dbs && dbs[0] ? dbs[0].id : null;
    if (!baseId) return;
    const { data, error } = await supabase.from("contacts").insert({
      base_id: baseId, nombre: newName.trim(), numero: newPhone.trim(), agregado_por: identity.nombre,
      asignado_a: identity.nombre, fecha_asignacion: todayStr(),
    }).select().single();
    if (!error) {
      setContacts([...contacts, data]);
      logEvent(baseId, data.id, "creado", { nombre: data.nombre });
      setNewName(""); setNewPhone("");
    }
  }

  const activos = contacts.filter((c) => ACTIVOS.includes(c.estado || "nuevo"));
  const resueltos = contacts.filter((c) => !ACTIVOS.includes(c.estado || "nuevo"));

  if (loading) return <p className="text-slate-500 text-sm text-center mt-16">{assigning ? "Repartiendo tus contactos de hoy..." : "Cargando..."}</p>;

  return (
    <div className="pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-indigo-300" />
        <h2 className="font-bold text-lg">Bases de datos</h2>
      </div>

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
    </div>
  );
}
