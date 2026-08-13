import React, { useState, useEffect } from "react";
import { Database, Users, Trash2, Plus, Sparkles } from "lucide-react";
import { Card } from "./ui";
import { uid, todayStr } from "./lib";
import { supabase } from "./supabaseClient";

export default function BasesView({ identity }) {
  const [assignment, setAssignment] = useState(undefined); // undefined = cargando, null = no tiene
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("assignments").select("*")
        .eq("empleado_id", identity.id).eq("fecha", todayStr())
        .order("created_at", { ascending: false }).limit(1);
      const a = data && data[0] ? data[0] : null;
      setAssignment(a);
      if (a) {
        const { data: cs } = await supabase.from("contacts").select("*").eq("base_id", a.base_id).order("created_at");
        setContacts(cs || []);
      }
      setLoading(false);
    })();
  }, [identity]);

  async function logEvent(accion, contactId, detalle) {
    await supabase.from("contact_events").insert({
      base_id: assignment.base_id, contact_id: contactId, empleado: identity.nombre, accion, detalle: detalle || {},
    });
  }

  async function toggle(c, field) {
    const patch = { [field]: !c[field], trabajada_por: identity.nombre, fecha_trabajo: todayStr() };
    const { error } = await supabase.from("contacts").update(patch).eq("id", c.id);
    if (!error) {
      setContacts(contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
      logEvent(field, c.id);
    }
  }

  const misAgregadosHoy = contacts.filter((c) => c.agregado_por === identity.nombre).length;
  const quotaRestante = assignment && assignment.quota != null ? assignment.quota - misAgregadosHoy : null;
  const puedeAgregar = !assignment || assignment.quota == null || quotaRestante > 0;

  async function addContact() {
    if (!newName.trim() || !puedeAgregar) return;
    const { data, error } = await supabase.from("contacts").insert({
      base_id: assignment.base_id, nombre: newName.trim(), numero: newPhone.trim(), agregado_por: identity.nombre,
    }).select().single();
    if (!error) {
      setContacts([...contacts, data]);
      logEvent("creado", data.id, { nombre: data.nombre });
      setNewName(""); setNewPhone("");
    }
  }

  if (loading) return <p className="text-slate-500 text-sm text-center mt-16">Cargando...</p>;

  return (
    <div className="pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-indigo-300" />
        <h2 className="font-bold text-lg">Bases de datos</h2>
      </div>

      {!assignment ? (
        <Card icon={<Sparkles size={15} />} title="Sin base asignada" subtitle="El admin todavía no te asignó una lista para hoy">
          <p className="text-slate-500 text-xs">Pedile al administrador que te asigne una base desde su panel.</p>
        </Card>
      ) : (
        <>
          <div className="bg-indigo-500/10 ring-1 ring-indigo-500/30 rounded-xl px-3.5 py-3 mb-4 flex items-center gap-2.5">
            <Sparkles size={16} className="text-indigo-300 flex-none" />
            <p className="text-xs text-slate-300"><span className="font-bold text-indigo-300">Hoy tenés asignada:</span> {assignment.base_nombre}</p>
          </div>

          <Card icon={<Users size={15} />} title={assignment.base_nombre} subtitle={`${contacts.length} contactos en esta base`}>
            <div className="max-h-96 overflow-y-auto mb-3 -mx-1 px-1">
              {contacts.length === 0 && <p className="text-slate-600 text-xs italic py-2">Todavía no hay contactos en esta base.</p>}
              {contacts.map((c) => (
                <div key={c.id} className="flex items-center gap-2 py-2 border-b border-white/5 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.nombre}</p>
                    <p className="text-slate-500 text-[10px]">{c.numero || "sin número"}</p>
                  </div>
                  {[["enviado", "E"], ["contestado", "C"], ["cargo", "$"]].map(([f, l]) => (
                    <button key={f} onClick={() => toggle(c, f)} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black ${c[f] ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white" : "bg-white/5 text-slate-600 ring-1 ring-white/5"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {assignment.quota != null && (
              <p className="text-[10px] text-amber-400 font-semibold mb-2">
                Podés agregar contactos nuevos: {Math.max(quotaRestante, 0)} de {assignment.quota} restantes hoy.
              </p>
            )}
            {puedeAgregar ? (
              <div className="grid grid-cols-7 gap-1.5">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre" className="input col-span-3 !py-1.5 text-xs" />
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Número" className="input col-span-3 !py-1.5 text-xs" />
                <button onClick={addContact} className="col-span-1 bg-white/5 ring-1 ring-white/10 rounded-lg flex items-center justify-center">
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 italic">Llegaste al límite de contactos que podés agregar hoy en esta base.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
