import React, { useState, useEffect, useMemo } from "react";
import {
  Sparkles, BarChart3, TrendingUp, Database, Users, Wallet, Lock,
  ArrowLeft, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle,
  Pencil, X, Plus, Upload, Coins,
} from "lucide-react";
import { Card, StatBox, MiniStat } from "./ui";
import { supabase } from "./supabaseClient";
import { PLATFORMS, DB_TYPES, FUENTE_TYPES, REACTIVACION_DIAS, daysSince, downloadCsv, num, money, todayStr, classifyTurno } from "./lib";

const CSV_HEADERS = [
  { key: "nombre", label: "Nombre" },
  { key: "numero", label: "Número" },
  { key: "base_nombre", label: "Base" },
  { key: "estado", label: "Estado" },
  { key: "trabajada_por", label: "Trabajado por" },
  { key: "fecha_trabajo", label: "Fecha" },
  { key: "motivo_descarte", label: "Motivo descarte" },
];

function computeShift(shift) {
  let ventasTotal = 0, retirosTotal = 0;
  let nuevos = 0, derivados = 0, cargasLista = 0, montoLista = 0, cargasCount = 0, retirosCount = 0;
  const porPlataforma = { B: { ventas: 0, premios: 0, bono: 0 }, G: { ventas: 0, premios: 0, bono: 0 } };
  (shift.ops || []).forEach((o) => {
    const m = num(o.monto);
    if (o.tipo === "carga") {
      ventasTotal += m; cargasCount++;
      if (porPlataforma[o.plataforma]) { porPlataforma[o.plataforma].ventas += m; porPlataforma[o.plataforma].bono += num(o.bono); }
      if (o.origen === "nuevo") nuevos++;
      if (o.origen === "derivado") derivados++;
      if (o.origen === "lista") { cargasLista++; montoLista += m; }
    } else {
      retirosTotal += m; retirosCount++;
      if (porPlataforma[o.plataforma]) porPlataforma[o.plataforma].premios += m;
    }
  });
  const bonoTotal = porPlataforma.B.bono + porPlataforma.G.bono;
  const bajadasTotal = (shift.bajadas || []).reduce((s, b) => s + num(b.monto), 0);
  const bajadasFichas = (shift.bajadas || []).filter((b) => b.destino === "Compra de fichas").reduce((s, b) => s + num(b.monto), 0);
  const bajadasGasto = (shift.bajadas || []).filter((b) => b.destino === "Gasto de oficina").reduce((s, b) => s + num(b.monto), 0);
  const bajadasEfectivo = (shift.bajadas || []).filter((b) => b.destino !== "Compra de fichas" && b.destino !== "Gasto de oficina").reduce((s, b) => s + num(b.monto), 0);
  const gastosDetalle = (shift.bajadas || []).filter((b) => b.destino === "Gasto de oficina");
  const billInicioTotal = Object.values(shift.bill_inicio || {}).reduce((s, v) => s + num(v), 0);
  const billCierreTotal = Object.values(shift.bill_cierre || {}).reduce((s, v) => s + num(v), 0);
  const efectivoEsperado = billInicioTotal + ventasTotal - retirosTotal - bajadasTotal;
  const diffEfectivo = billCierreTotal - efectivoEsperado;
  // Neto = ganancia real del turno: lo que entró por cargas menos lo que salió en premios.
  // Las bajadas (a efectivo, a fichas, o a un gasto) son solo información de a dónde fue esa
  // plata — nunca se restan del Neto.
  const netoCaja = ventasTotal - retirosTotal;
  const movimientosCount = cargasCount + retirosCount;
  // Diferencia de fichas: lo esperado (arrastre + cargas/bono/retiros/movimientos) contra lo informado al cierre.
  const diffFichas = {};
  PLATFORMS.forEach((p) => {
    const stockIni = num((shift.stock_inicio || {})[p.key]);
    const mov = (shift.movs || []).filter((m) => m.plataforma === p.key).reduce((s, m) => s + num(m.monto), 0);
    const esperado = stockIni - porPlataforma[p.key].ventas - porPlataforma[p.key].bono + porPlataforma[p.key].premios + mov;
    const informadoRaw = (shift.stock_cierre || {})[p.key];
    diffFichas[p.key] = informadoRaw === undefined || informadoRaw === "" || informadoRaw == null ? null : num(informadoRaw) - esperado;
  });
  const justif = shift.error_justificado || {};
  const efectivoErrorRaw = Math.abs(diffEfectivo) >= 1;
  const efectivoError = efectivoErrorRaw && !justif.efectivo;
  const fichasErrorRaw = {}; const fichasError = {};
  PLATFORMS.forEach((p) => {
    const d = diffFichas[p.key];
    fichasErrorRaw[p.key] = d !== null && Math.abs(d) >= 1;
    fichasError[p.key] = fichasErrorRaw[p.key] && !justif[p.key];
  });
  const hasErrorRaw = efectivoErrorRaw || Object.values(fichasErrorRaw).some(Boolean);
  const hasError = efectivoError || Object.values(fichasError).some(Boolean); // lo justificado no cuenta para las estadísticas
  return {
    shift, ventasTotal, retirosTotal, bajadasTotal, bajadasFichas, bajadasEfectivo, bajadasGasto, gastosDetalle, netoCaja, bonoTotal, diffEfectivo, diffFichas, hasError, hasErrorRaw, efectivoErrorRaw, fichasErrorRaw,
    billInicioTotal, billCierreTotal,
    nuevos, derivados, cargasLista, montoLista, cargasCount, retirosCount, movimientosCount,
    opsCount: (shift.ops || []).length, porPlataforma,
  };
}

export default function AdminDashboard({ adminPin, onExit }) {
  const [tab, setTab] = useState("resumen");
  const [shifts, setShifts] = useState([]);
  const [liveShifts, setLiveShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [dbs, setDbs] = useState([]);
  const [dbStats, setDbStats] = useState({});
  const [empTodayBaseStats, setEmpTodayBaseStats] = useState({});
  const [workedContacts, setWorkedContacts] = useState([]);
  const [reactivables, setReactivables] = useState([]);
  const [allContactsFlat, setAllContactsFlat] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [refuerzos, setRefuerzos] = useState([]);
  const [accessLog, setAccessLog] = useState([]);
  const [poolDisponible, setPoolDisponible] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [turnosVisibles, setTurnosVisibles] = useState(15);
  const [archivados, setArchivados] = useState(null); // null = no cargados todavía
  const [rangeKey, setRangeKey] = useState("7d");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [opsModal, setOpsModal] = useState(null);

  async function loadArchivados() {
    const { data } = await supabase.from("shifts").select("*").eq("archivado", true).order("updated_at", { ascending: false }).limit(200);
    setArchivados(data || []);
  }
  async function restaurarTurno(id) {
    await supabase.from("shifts").update({ archivado: false }).eq("id", id);
    await loadArchivados(); loadAll();
  }

  async function loadAll() {
    setLoading(true);
    const [{ data: closedShifts }, { data: live }, { data: emp }, { data: wal }, { data: dbList }] = await Promise.all([
      supabase.from("shifts").select("*").eq("status", "cerrado").eq("archivado", false).order("cerrado_at", { ascending: false, nullsFirst: false }),
      supabase.from("shifts").select("*").eq("status", "abierto").eq("archivado", false).order("updated_at", { ascending: false }),
      supabase.rpc("admin_list_employees", { input_admin_pin: adminPin }),
      supabase.from("wallets").select("*").order("orden"),
      supabase.from("databases").select("*").order("created_at", { ascending: false }),
    ]);
    setShifts(closedShifts || []);
    setLiveShifts(live || []);
    setEmployees(emp || []);
    setWallets(wal || []);
    setDbs(dbList || []);

    const stats = {}; const empStats = {}; const worked = []; const reactivables = []; const flat = []; let poolDisponible = 0;
    const { data: allContacts } = await supabase.rpc("admin_list_contacts", { input_admin_pin: adminPin });
    for (const d of (dbList || [])) {
      const cs = (allContacts || []).filter((c) => c.base_id === d.id);
      const agregadosPorEmpleado = cs.filter((c) => c.agregado_por && c.agregado_por !== "admin");
      stats[d.id] = { total: cs.length, enviados: cs.filter((c) => c.enviado).length, contestados: cs.filter((c) => c.contestado).length, cargaron: cs.filter((c) => c.cargo).length, agregadosPorEmpleado };
      cs.forEach((c) => {
        flat.push({ ...c, base_nombre: d.nombre });
        if (["nuevo", "contactado"].includes(c.estado || "nuevo") && (!c.asignado_a || c.fecha_asignacion < todayStr())) poolDisponible++;
        if (c.fecha_trabajo && c.trabajada_por) {
          worked.push({ trabajada_por: c.trabajada_por, fecha: c.fecha_trabajo, enviado: !!c.enviado, contestado: !!c.contestado, cargo: !!c.cargo });
        }
        if (c.fecha_trabajo === todayStr() && c.trabajada_por) {
          if (!empStats[c.trabajada_por]) empStats[c.trabajada_por] = { contactados: 0, contestados: 0, cargaron: 0 };
          if (c.enviado) empStats[c.trabajada_por].contactados++;
          if (c.contestado) empStats[c.trabajada_por].contestados++;
          if (c.cargo) empStats[c.trabajada_por].cargaron++;
        }
        if ((c.estado || (c.cargo ? "cargado" : "nuevo")) === "cargado" && daysSince(c.ultimo_contacto) >= REACTIVACION_DIAS) {
          reactivables.push({ ...c, base_nombre: d.nombre });
        }
      });
    }
    setDbStats(stats); setEmpTodayBaseStats(empStats); setWorkedContacts(worked); setReactivables(reactivables);
    setAllContactsFlat(flat); setPoolDisponible(poolDisponible);

    const { data: sessions } = await supabase.rpc("admin_active_sessions", { input_admin_pin: adminPin });
    setActiveSessions(sessions || []);
    const { data: refs } = await supabase.rpc("admin_list_refuerzos", { input_admin_pin: adminPin });
    setRefuerzos(refs || []);
    const { data: log } = await supabase.rpc("admin_list_access_log", { input_admin_pin: adminPin });
    setAccessLog(log || []);

    setLoading(false);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    // El refresco automático NO corre por defecto — el admin lo prende si quiere,
    // desde el interruptor en "Resumen". Así nunca se actualiza sin que vos lo pidas.
    if (tab !== "resumen" || !autoRefresh) return;
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  }, [tab, autoRefresh]);

  // --- Filtro de fechas para el análisis histórico ---
  function applyPreset(key) {
    setRangeKey(key);
    const today = todayStr();
    if (key === "hoy") { setDateFrom(today); setDateTo(today); }
    else if (key === "7d") { const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); }
    else if (key === "mes") { const d = new Date(); d.setDate(1); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); }
    else if (key === "todo") { setDateFrom(""); setDateTo(""); }
  }
  useEffect(() => { applyPreset("7d"); }, []);

  const filteredShifts = useMemo(() => {
    if (!dateFrom && !dateTo) return shifts;
    return shifts.filter((s) => (!dateFrom || s.fecha >= dateFrom) && (!dateTo || s.fecha <= dateTo));
  }, [shifts, dateFrom, dateTo]);

  const computedAll = useMemo(() => shifts.map(computeShift), [shifts]);
  const computed = useMemo(() => filteredShifts.map(computeShift), [filteredShifts]);

  const totals = useMemo(() => {
    const t = { ventas: 0, retiros: 0, bajadas: 0, bajadasFichas: 0, bajadasEfectivo: 0, bajadasGasto: 0, neto: 0, bono: 0, nuevos: 0, derivados: 0 };
    computed.forEach((c) => { t.ventas += c.ventasTotal; t.retiros += c.retirosTotal; t.bajadas += c.bajadasTotal; t.bajadasFichas += c.bajadasFichas; t.bajadasEfectivo += c.bajadasEfectivo; t.bajadasGasto += c.bajadasGasto; t.neto += c.netoCaja; t.bono += c.bonoTotal; t.nuevos += c.nuevos; t.derivados += c.derivados; });
    return t;
  }, [computed]);

  const totalsPorPlataforma = useMemo(() => {
    const t = { B: { ventas: 0, premios: 0, bono: 0 }, G: { ventas: 0, premios: 0, bono: 0 } };
    computed.forEach((c) => { PLATFORMS.forEach((p) => { t[p.key].ventas += c.porPlataforma[p.key].ventas; t[p.key].premios += c.porPlataforma[p.key].premios; t[p.key].bono += c.porPlataforma[p.key].bono; }); });
    return t;
  }, [computed]);

  const gastosList = useMemo(() => {
    const list = [];
    computed.forEach((c) => {
      c.gastosDetalle.forEach((g) => list.push({ fecha: c.shift.fecha, responsable: c.shift.responsable, nota: g.nota, monto: num(g.monto) }));
    });
    return list.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [computed]);

  const byEmployee = useMemo(() => {
    const map = {};
    computed.forEach((c) => {
      const r = c.shift.responsable;
      if (!map[r]) map[r] = { turnos: 0, contactaron: 0, contestaron: 0, cargaron: 0, cargas: 0, retiros: 0, errores: 0, diffEfectivoTotal: 0, diffFichas: { B: 0, G: 0 } };
      const e = map[r];
      e.turnos++; e.cargas += c.cargasCount; e.retiros += c.retirosCount;
      if (c.hasError) { e.errores++; e.diffEfectivoTotal += Math.abs(c.diffEfectivo); PLATFORMS.forEach((p) => { if (c.diffFichas[p.key] !== null) e.diffFichas[p.key] += Math.abs(c.diffFichas[p.key]); }); }
    });
    workedContacts.forEach((w) => {
      if (dateFrom && w.fecha < dateFrom) return;
      if (dateTo && w.fecha > dateTo) return;
      if (!map[w.trabajada_por]) map[w.trabajada_por] = { turnos: 0, contactaron: 0, contestaron: 0, cargaron: 0, cargas: 0, retiros: 0, errores: 0, diffEfectivoTotal: 0, diffFichas: { B: 0, G: 0 } };
      const e = map[w.trabajada_por];
      if (w.enviado) e.contactaron++;
      if (w.contestado) e.contestaron++;
      if (w.cargo) e.cargaron++;
    });
    return Object.entries(map).sort((a, b) => b[1].turnos - a[1].turnos);
  }, [computed, workedContacts, dateFrom, dateTo]);

  const byTurno = useMemo(() => {
    const map = { Mañana: { ventas: 0, neto: 0, count: 0 }, Tarde: { ventas: 0, neto: 0, count: 0 }, Noche: { ventas: 0, neto: 0, count: 0 } };
    computed.forEach((c) => {
      const t = c.shift.turno_label || classifyTurno(c.shift.hora_inicio);
      if (!map[t]) map[t] = { ventas: 0, neto: 0, count: 0 };
      map[t].ventas += c.ventasTotal; map[t].neto += c.netoCaja; map[t].count++;
    });
    return Object.entries(map).sort((a, b) => b[1].neto - a[1].neto);
  }, [computed]);

  // Igual que "byEmployee": junta lo que pasó en los turnos (operaciones N/L/R) con lo
  // que pasó en bases (enviados/contestados/cargaron), pero agrupado por fecha en vez
  // de por empleado. Respeta el mismo rango de fechas elegido arriba en "Análisis".
  const byDate = useMemo(() => {
    const map = {};
    const ensure = (fecha) => {
      if (!map[fecha]) map[fecha] = { fecha, enviados: 0, contestados: 0, cargaron: 0, opsNuevo: 0, opsLista: 0, opsDerivado: 0 };
      return map[fecha];
    };
    computed.forEach((c) => {
      const e = ensure(c.shift.fecha);
      e.opsNuevo += c.nuevos;
      e.opsDerivado += c.derivados;
      e.opsLista += c.cargasLista;
    });
    workedContacts.forEach((w) => {
      if (dateFrom && w.fecha < dateFrom) return;
      if (dateTo && w.fecha > dateTo) return;
      const e = ensure(w.fecha);
      if (w.enviado) e.enviados++;
      if (w.contestado) e.contestados++;
      if (w.cargo) e.cargaron++;
    });
    return Object.values(map).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [computed, workedContacts, dateFrom, dateTo]);

  const ahoraMismo = useMemo(() => {
    const live = liveShifts[0];
    if (live) {
      const billInicioTotal = Object.values(live.bill_inicio || {}).reduce((s, v) => s + num(v), 0);
      let ventasTotal = 0, retirosTotal = 0;
      const stockDelta = { B: 0, G: 0 };
      const porPlataforma = { B: { ventas: 0, premios: 0, bono: 0 }, G: { ventas: 0, premios: 0, bono: 0 } };
      (live.ops || []).forEach((o) => {
        const m = num(o.monto);
        if (o.tipo === "carga") { ventasTotal += m; stockDelta[o.plataforma] -= m + num(o.bono); porPlataforma[o.plataforma].ventas += m; porPlataforma[o.plataforma].bono += num(o.bono); }
        else { retirosTotal += m; stockDelta[o.plataforma] += m; porPlataforma[o.plataforma].premios += m; }
      });
      const bajadasTotal = (live.bajadas || []).reduce((s, b) => s + num(b.monto), 0);
      const bajadasFichas = (live.bajadas || []).filter((b) => b.destino === "Compra de fichas").reduce((s, b) => s + num(b.monto), 0);
      const bajadasGasto = (live.bajadas || []).filter((b) => b.destino === "Gasto de oficina").reduce((s, b) => s + num(b.monto), 0);
      const bajadasEfectivo = bajadasTotal - bajadasFichas - bajadasGasto;
      const cajaTotal = billInicioTotal + ventasTotal - retirosTotal - bajadasTotal;
      const fichas = {};
      PLATFORMS.forEach((p) => {
        const stockIni = num((live.stock_inicio || {})[p.key]);
        const mov = (live.movs || []).filter((m) => m.plataforma === p.key).reduce((s, m) => s + num(m.monto), 0);
        fichas[p.key] = stockIni + stockDelta[p.key] + mov;
      });
      const baseStats = empTodayBaseStats[live.responsable] || { contactados: 0, contestados: 0, cargaron: 0 };
      return {
        enVivo: true, responsable: live.responsable, cajaTotal, ventasTurno: ventasTotal, premiosTurno: retirosTotal, fichas, porPlataforma,
        bajadasTotal, bajadasFichas, bajadasGasto, bajadasEfectivo,
        contactaron: baseStats.contactados, contestaron: baseStats.contestados, cargaron: baseStats.cargaron,
        movimientos: (live.ops || []).length, opsCount: (live.ops || []).length, ops: live.ops || [], horaInicio: live.hora_inicio,
      };
    }
    if (shifts.length) {
      const last = shifts[0]; const c = computeShift(last);
      const billCierreTotal = Object.values(last.bill_cierre || {}).reduce((s, v) => s + num(v), 0);
      const baseStats = empTodayBaseStats[last.responsable] || { contactados: 0, contestados: 0, cargaron: 0 };
      return {
        enVivo: false, responsable: last.responsable, cajaTotal: billCierreTotal, ventasTurno: c.ventasTotal, premiosTurno: c.retirosTotal,
        fichas: null, porPlataforma: c.porPlataforma,
        bajadasTotal: c.bajadasTotal, bajadasFichas: c.bajadasFichas, bajadasGasto: c.bajadasGasto, bajadasEfectivo: c.bajadasEfectivo,
        contactaron: baseStats.contactados, contestaron: baseStats.contestados, cargaron: baseStats.cargaron,
        movimientos: c.cargasCount + c.retirosCount, opsCount: (last.ops || []).length, ops: last.ops || [],
      };
    }
    return null;
  }, [liveShifts, shifts, empTodayBaseStats]);

  if (loading) return <p className="text-slate-500 text-sm text-center mt-16">Cargando panel...</p>;

  const subtabs = [
    { key: "resumen", label: "Resumen", icon: <BarChart3 size={12} /> },
    { key: "turnos", label: "Turnos", icon: <TrendingUp size={12} /> },
    { key: "analisis", label: "Análisis", icon: <TrendingUp size={12} /> },
    { key: "bases", label: "Bases", icon: <Database size={12} /> },
    { key: "clientes", label: "Clientes", icon: <Users size={12} /> },
    { key: "empleados", label: "Empleados", icon: <Users size={12} /> },
    { key: "billeteras", label: "Billeteras", icon: <Wallet size={12} /> },
  ];

  return (
    <div className="pt-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-xl">Panel Admin</h2>
        <button onClick={onExit} className="text-slate-500 text-xs flex items-center gap-1"><ArrowLeft size={12} /> Salir</button>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {subtabs.map((s) => (
          <button key={s.key} onClick={() => setTab(s.key)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${tab === s.key ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white" : "bg-white/5 text-slate-400"}`}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
        <>
          <div className="flex items-center justify-between bg-white/[0.03] ring-1 ring-white/5 rounded-xl px-3 py-2 mb-3">
            <div className="flex items-center gap-2">
              <button onClick={loadAll} className="text-[11px] font-bold text-indigo-300 flex items-center gap-1"><Sparkles size={12} /> Actualizar ahora</button>
              {lastUpdated && <span className="text-[10px] text-slate-600">actualizado {lastUpdated.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
            </div>
            <button onClick={() => setAutoRefresh(!autoRefresh)} className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${autoRefresh ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"}`}>
              {autoRefresh ? "Auto: ON" : "Auto: OFF"}
            </button>
          </div>
          {ahoraMismo && (
            <Card
              icon={<Wallet size={15} />} title="Ahora mismo"
              subtitle={ahoraMismo.enVivo ? `Turno en vivo · ${ahoraMismo.responsable}` : `Sin turno abierto · según el último cierre de ${ahoraMismo.responsable}`}
              right={ahoraMismo.enVivo ? <span className="text-[9px] bg-emerald-500/15 text-emerald-400 rounded-full px-2 py-0.5 font-bold animate-pulse">EN VIVO</span> : null}
            >
              <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Caja total ahora</p>
              <p className="text-3xl font-black text-emerald-400 mb-3">{money(ahoraMismo.cajaTotal)}</p>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <div className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] text-slate-500 uppercase">Vendido</p>
                  <p className="text-base font-black text-emerald-400">{money(ahoraMismo.ventasTurno)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] text-slate-500 uppercase">Premios</p>
                  <p className="text-base font-black text-rose-400">{money(ahoraMismo.premiosTurno)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-2.5 text-center">
                  <p className="text-[9px] text-slate-500 uppercase">Neto</p>
                  <p className={`text-base font-black ${(ahoraMismo.ventasTurno - ahoraMismo.premiosTurno) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {money(ahoraMismo.ventasTurno - ahoraMismo.premiosTurno)}
                  </p>
                </div>
                <button
                  onClick={() => setOpsModal({ title: `${ahoraMismo.responsable} · ${ahoraMismo.enVivo ? "en vivo" : "último cierre"}`, ops: ahoraMismo.ops, live: ahoraMismo.enVivo })}
                  className="bg-white/5 rounded-lg p-2.5 text-center ring-1 ring-transparent hover:ring-indigo-400/40"
                >
                  <p className="text-[9px] text-slate-500 uppercase">Operaciones</p>
                  <p className="text-base font-black text-indigo-300 underline">{ahoraMismo.opsCount}</p>
                </button>
              </div>
              <PlataformaBreakdown porPlataforma={ahoraMismo.porPlataforma} />
              {ahoraMismo.fichas && (
                <div className="grid grid-cols-2 gap-2 mt-2 mb-2">
                  {PLATFORMS.map((p) => (
                    <div key={p.key} className="flex justify-between bg-white/5 rounded-lg px-2.5 py-1.5 text-[11px]">
                      <span className="text-slate-500">Fichas {p.label} restantes</span>
                      <span className="font-bold">{Math.round(ahoraMismo.fichas[p.key]).toLocaleString("es-AR")}</span>
                    </div>
                  ))}
                </div>
              )}
              {ahoraMismo.bajadasTotal > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="bg-white/5 rounded-lg px-2.5 py-1.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Bajado a efectivo</p>
                    <p className="text-sm font-black">{money(ahoraMismo.bajadasEfectivo)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2.5 py-1.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Compra de fichas</p>
                    <p className="text-sm font-black text-indigo-300">{money(ahoraMismo.bajadasFichas)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg px-2.5 py-1.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Gastos</p>
                    <p className="text-sm font-black text-amber-400">{money(ahoraMismo.bajadasGasto)}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 mt-2">
                <div className="text-center"><p className="text-lg font-black">{ahoraMismo.contactaron}</p><p className="text-[9px] text-slate-500 uppercase">Contactaron</p></div>
                <div className="text-center"><p className="text-lg font-black">{ahoraMismo.contestaron}</p><p className="text-[9px] text-slate-500 uppercase">Contestaron</p></div>
                <div className="text-center"><p className="text-lg font-black">{ahoraMismo.cargaron}</p><p className="text-[9px] text-slate-500 uppercase">Cargaron</p></div>
                <div className="text-center"><p className="text-lg font-black">{ahoraMismo.movimientos}</p><p className="text-[9px] text-slate-500 uppercase">Movimientos (cargas+retiros)</p></div>
              </div>
            </Card>
          )}
          {refuerzos.filter((r) => !r.fin).map((r) => {
            const stats = empTodayBaseStats[r.empleado] || { contactados: 0, contestados: 0, cargaron: 0 };
            return (
              <Card
                key={r.id}
                icon={<Users size={15} />} title="Ahora mismo — refuerzo"
                subtitle={`${r.empleado} · en bases desde las ${new Date(r.inicio).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
                right={<span className="text-[9px] bg-emerald-500/15 text-emerald-400 rounded-full px-2 py-0.5 font-bold animate-pulse">EN VIVO</span>}
              >
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/5 rounded-lg p-2.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Contactaron</p>
                    <p className="text-lg font-black">{stats.contactados}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Contestaron</p>
                    <p className="text-lg font-black">{stats.contestados}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2.5 text-center">
                    <p className="text-[9px] text-slate-500 uppercase">Cargaron</p>
                    <p className="text-lg font-black text-emerald-400">{stats.cargaron}</p>
                  </div>
                </div>
              </Card>
            );
          })}
          {activeSessions.length > 0 && (
            <Card icon={<Sparkles size={15} />} title="Conectados ahora" subtitle={`${new Set(activeSessions.map((s) => s.nombre)).size} persona(s) con sesión activa`}>
              <div className="space-y-1.5">
                {[...new Map(activeSessions.map((s) => [s.nombre, s])).values()].map((s) => (
                  <div key={s.nombre} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-1.5">
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {s.nombre}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      entró {new Date(s.entro_a).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                      {" · vence "}{new Date(s.vence_a).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5">Incluye a cualquiera logueado con su PIN, tenga o no la caja abierta. Si alguien aparece acá pero ya no está trabajando, va a desaparecer solo cuando venza (hasta 14hs) o cuando vuelva a entrar con su PIN.</p>
            </Card>
          )}
          {accessLog.length > 0 && (
            <Card icon={<Users size={15} />} title="Accesos recientes" subtitle="Últimos 20 ingresos con PIN — empleados y admin">
              <div className="space-y-1.5">
                {accessLog.map((a) => (
                  <div key={a.id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2 text-xs">
                    <span className={`font-bold ${a.tipo === "admin" ? "text-amber-400" : "text-indigo-300"}`}>
                      {a.tipo === "admin" ? "🔒 Admin" : a.nombre}
                    </span>
                    <span className="text-slate-400">
                      {new Date(a.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {liveShifts.length > 0 && (
            <Card icon={<Sparkles size={15} />} title="Turno abierto" subtitle="Si quedó trabado de una prueba, lo podés archivar acá">
              {liveShifts.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                  <span className="text-slate-300">{s.responsable} · desde {s.hora_inicio}</span>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`¿Archivar el turno abierto de ${s.responsable}? Es para pruebas viejas o turnos trabados. Queda guardado, no se pierde, pero se libera la caja para abrir uno nuevo.`)) return;
                      await supabase.from("shifts").update({ archivado: true, updated_at: new Date().toISOString() }).eq("id", s.id); loadAll();
                    }}
                    className="text-rose-400 text-[10px] font-bold flex items-center gap-1"
                  >
                    <X size={12} /> Archivar
                  </button>
                </div>
              ))}
            </Card>
          )}

        </>
      )}

      {tab === "analisis" && (
        <>
          <DateRangeFilter rangeKey={rangeKey} dateFrom={dateFrom} dateTo={dateTo} onPreset={applyPreset} onFrom={(v) => { setRangeKey("custom"); setDateFrom(v); }} onTo={(v) => { setRangeKey("custom"); setDateTo(v); }} />

          <h3 className="font-bold text-sm mb-2 mt-4 text-slate-400">Análisis de totales ({computed.length} turnos)</h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <StatBox label="Ventas totales" value={money(totals.ventas)} positive />
            <StatBox label="Retiros pagados" value={money(totals.retiros)} negative />
            <StatBox label="Bono dado" value={money(totals.bono)} />
            <StatBox label="Neto (ventas − premios)" value={money(totals.neto)} positive={totals.neto >= 0} negative={totals.neto < 0} />
          </div>
          <Card icon={<TrendingUp size={15} className="rotate-180" />} title="Bajadas" subtitle="A dónde fue esa plata — no se resta del Neto">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <p className="text-[9px] text-slate-500 uppercase">Efectivo</p>
                <p className="text-sm font-black">{money(totals.bajadasEfectivo)}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <p className="text-[9px] text-slate-500 uppercase">Fichas</p>
                <p className="text-sm font-black text-indigo-300">{money(totals.bajadasFichas)}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <p className="text-[9px] text-slate-500 uppercase">Gastos</p>
                <p className="text-sm font-black text-amber-400">{money(totals.bajadasGasto)}</p>
              </div>
            </div>
            {gastosList.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Detalle de gastos ({gastosList.length})</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {gastosList.map((g, i) => (
                    <div key={i} className="flex justify-between bg-black/20 rounded-lg px-2.5 py-1.5 text-[11px]">
                      <span className="text-slate-400">{g.fecha} · {g.responsable} · {g.nota || "sin detalle"}</span>
                      <span className="font-bold text-amber-400">{money(g.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <Card icon={<TrendingUp size={15} />} title="Neto y bono por plataforma">
            <PlataformaBreakdown porPlataforma={totalsPorPlataforma} />
          </Card>
          <Card icon={<TrendingUp size={15} />} title="Efectividad por franja">
            {byTurno.map(([label, d]) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 text-xs">
                <p className="font-bold">{label}</p>
                <p className="text-slate-500">{d.count} turnos · ventas {money(d.ventas)}</p>
                <p className={`font-bold ${d.neto >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(d.neto)}</p>
              </div>
            ))}
          </Card>
          <Card icon={<TrendingUp size={15} />} title="Por día" subtitle="Mensajes, respuestas y cargas, día a día — en el período elegido arriba">
            {byDate.length === 0 ? (
              <p className="text-slate-600 text-xs italic">Sin actividad en este período.</p>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900">
                    <tr className="text-slate-500 text-left">
                      <th className="py-2 px-2 font-semibold">Fecha</th>
                      <th className="py-2 px-2 font-semibold text-right">Enviados</th>
                      <th className="py-2 px-2 font-semibold text-right">Contestaron</th>
                      <th className="py-2 px-2 font-semibold text-right">Cargaron</th>
                      <th className="py-2 px-2 font-semibold text-right">N</th>
                      <th className="py-2 px-2 font-semibold text-right">L</th>
                      <th className="py-2 px-2 font-semibold text-right">R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDate.map((d) => (
                      <tr key={d.fecha} className="border-t border-white/5">
                        <td className="py-2 px-2 font-bold">{d.fecha}</td>
                        <td className="py-2 px-2 text-right">{d.enviados}</td>
                        <td className="py-2 px-2 text-right">{d.contestados}</td>
                        <td className="py-2 px-2 text-right text-emerald-400 font-bold">{d.cargaron}</td>
                        <td className="py-2 px-2 text-right text-slate-400">{d.opsNuevo}</td>
                        <td className="py-2 px-2 text-right text-slate-400">{d.opsLista}</td>
                        <td className="py-2 px-2 text-right text-slate-400">{d.opsDerivado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[9px] text-slate-600 mt-2">N = cliente nuevo/publicidad · L = de lista · R = derivado/referido. Estas 3 columnas cuentan operaciones de carga, no contactos de bases.</p>
              </div>
            )}
          </Card>

          <Card icon={<Users size={15} />} title="Estadísticas por empleado" subtitle="En el período seleccionado arriba">
            {byEmployee.length === 0 && <p className="text-slate-600 text-xs italic">Sin turnos ni actividad en este período.</p>}
            {byEmployee.map(([nombre, e]) => (
              <div key={nombre} className="py-2.5 border-b border-white/5 last:border-0">
                <p className="font-bold text-sm text-indigo-300 mb-1.5">{nombre} · {e.turnos} turno{e.turnos !== 1 ? "s" : ""}</p>
                <div className="grid grid-cols-3 gap-1.5 text-center mb-1.5">
                  <MiniStat label="Contactaron" value={e.contactaron} />
                  <MiniStat label="Contestaron" value={e.contestaron} />
                  <MiniStat label="Cargaron (bases)" value={e.cargaron} />
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-center mb-1.5">
                  <MiniStat label="Cargas (operaciones)" value={e.cargas} />
                  <MiniStat label="Retiros (operaciones)" value={e.retiros} />
                </div>
                {e.errores > 0 ? (
                  <div className="bg-amber-500/10 ring-1 ring-amber-500/20 rounded-lg px-2.5 py-1.5 text-[10px] text-amber-400">
                    <b>{e.errores}</b> cierre{e.errores !== 1 ? "s" : ""} con diferencia · efectivo {money(e.diffEfectivoTotal)} · fichas BET {Math.round(e.diffFichas.B).toLocaleString("es-AR")} · fichas GANA {Math.round(e.diffFichas.G).toLocaleString("es-AR")}
                  </div>
                ) : (
                  <p className="text-[10px] text-emerald-400">Sin diferencias de cierre en este período.</p>
                )}
              </div>
            ))}
          </Card>

        </>
      )}

      {tab === "turnos" && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-slate-400">Detalle de turnos ({computedAll.length})</h3>
            <button
              onClick={() => { if (archivados === null) loadArchivados(); else setArchivados(null); }}
              className="text-[10px] font-bold text-indigo-300 underline"
            >
              {archivados === null ? "Ver archivados" : "Ocultar archivados"}
            </button>
          </div>
          {archivados !== null && (
            <div className="bg-white/[0.02] ring-1 ring-white/5 rounded-2xl p-3 mb-3">
              <p className="text-[10px] text-slate-500 font-semibold mb-2">Archivados ({archivados.length}) — no cuentan en ninguna estadística</p>
              {archivados.length === 0 && <p className="text-slate-600 text-xs italic">No hay turnos archivados.</p>}
              <div className="space-y-1.5">
                {archivados.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2 text-xs">
                    <span className="text-slate-400">
                      {s.fecha} · {s.hora_inicio?.slice(0, 5)}{s.hora_fin ? ` → ${s.hora_fin.slice(0, 5)}` : ""} · <span className="text-indigo-300 font-bold">{s.responsable}</span>
                    </span>
                    <button onClick={() => restaurarTurno(s.id)} className="text-emerald-400 font-bold text-[10px]">Restaurar</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {computedAll.slice(0, turnosVisibles).map((c) => (
            <ShiftRow
              key={c.shift.id} c={c} expanded={expanded === c.shift.id}
              onToggle={() => setExpanded(expanded === c.shift.id ? null : c.shift.id)}
              onDelete={async (id) => { await supabase.from("shifts").update({ archivado: true, updated_at: new Date().toISOString() }).eq("id", id); setExpanded(null); loadAll(); }}
              onOpenOps={setOpsModal}
              adminPin={adminPin} onChange={loadAll}
            />
          ))}
          {turnosVisibles < computedAll.length && (
            <button
              onClick={() => setTurnosVisibles((n) => n + 15)}
              className="w-full bg-white/5 ring-1 ring-white/10 rounded-xl py-2.5 text-xs font-bold text-slate-400 mt-1"
            >
              Cargar 15 más ({computedAll.length - turnosVisibles} restantes)
            </button>
          )}
        </>
      )}

      {tab === "bases" && (
        <>
          {refuerzos.filter((r) => r.fin).length > 0 && (
            <Card icon={<Users size={15} />} title="Historial de refuerzos" subtitle="Últimas sesiones ya finalizadas, con lo que cada una logró">
              <div className="space-y-2 max-h-72 overflow-y-auto -mx-1 px-1">
                {refuerzos.filter((r) => r.fin).map((r) => {
                  const inicio = new Date(r.inicio);
                  const fin = new Date(r.fin);
                  const minutos = Math.max(0, Math.round((fin - inicio) / 60000));
                  const horas = Math.floor(minutos / 60);
                  const mins = minutos % 60;
                  const duracion = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
                  const fechaSesion = inicio.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
                  const st = workedContacts
                    .filter((w) => w.trabajada_por === r.empleado && w.fecha === fechaSesion)
                    .reduce((acc, w) => {
                      if (w.enviado) acc.contactados++;
                      if (w.contestado) acc.contestados++;
                      if (w.cargo) acc.cargaron++;
                      return acc;
                    }, { contactados: 0, contestados: 0, cargaron: 0 });
                  return (
                    <div key={r.id} className="bg-white/5 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <p className="text-xs font-bold">{r.empleado}</p>
                          <p className="text-[10px] text-slate-500">
                            {inicio.toLocaleDateString("es-AR")} · {inicio.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} → {fin.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">{duracion}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="bg-black/20 rounded-lg py-1.5 text-center">
                          <p className="text-sm font-black">{st.contactados}</p>
                          <p className="text-[9px] text-slate-500 uppercase">Contactó</p>
                        </div>
                        <div className="bg-black/20 rounded-lg py-1.5 text-center">
                          <p className="text-sm font-black">{st.contestados}</p>
                          <p className="text-[9px] text-slate-500 uppercase">Contestó</p>
                        </div>
                        <div className="bg-black/20 rounded-lg py-1.5 text-center">
                          <p className="text-sm font-black text-emerald-400">{st.cargaron}</p>
                          <p className="text-[9px] text-slate-500 uppercase">Cargó</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          <BasesAdmin employees={employees} dbs={dbs} dbStats={dbStats} reactivables={reactivables} allContactsFlat={allContactsFlat} poolDisponible={poolDisponible} adminPin={adminPin} onChange={loadAll} />
        </>
      )}
      {tab === "clientes" && <ClientesRanking computedAll={computedAll} />}
      {tab === "empleados" && <EmployeeManager employees={employees} adminPin={adminPin} onChange={loadAll} />}
      {tab === "billeteras" && <WalletManager wallets={wallets} adminPin={adminPin} onChange={loadAll} />}
      <OpsSheetModal data={opsModal} onClose={() => setOpsModal(null)} />
    </div>
  );
}

function DateRangeFilter({ rangeKey, dateFrom, dateTo, onPreset, onFrom, onTo }) {
  const presets = [
    { key: "hoy", label: "Hoy" },
    { key: "7d", label: "Últimos 7 días" },
    { key: "mes", label: "Este mes" },
    { key: "todo", label: "Todo" },
  ];
  return (
    <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl p-3 mb-3">
      <div className="flex gap-1.5 flex-wrap mb-2">
        {presets.map((p) => (
          <button key={p.key} onClick={() => onPreset(p.key)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${rangeKey === p.key ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-400"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="date" value={dateFrom} onChange={(e) => onFrom(e.target.value)} className="input !py-1.5 text-[11px] flex-1" />
        <span className="text-slate-600 text-xs">a</span>
        <input type="date" value={dateTo} onChange={(e) => onTo(e.target.value)} className="input !py-1.5 text-[11px] flex-1" />
      </div>
    </div>
  );
}

function OpsSheetModal({ data, onClose }) {
  if (!data) return null;
  const ops = data.ops || [];
  const splitByPlatform = !data.live;

  function renderTable(rows, showIndexFrom = 0) {
    return (
      <table className="w-full text-xs mb-4">
        <thead className="bg-slate-900">
          <tr className="text-slate-500 text-left">
            <th className="py-2 px-2 font-semibold">#</th>
            <th className="py-2 px-2 font-semibold">Plataforma</th>
            <th className="py-2 px-2 font-semibold">Tipo</th>
            <th className="py-2 px-2 font-semibold text-right">Monto</th>
            <th className="py-2 px-2 font-semibold text-right">Bono</th>
            <th className="py-2 px-2 font-semibold">Origen</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-center text-slate-600 italic">Sin operaciones.</td></tr>
          )}
          {rows.map((o, i) => (
            <tr key={o.id || i} className="border-t border-white/5">
              <td className="py-2 px-2 text-slate-600">{showIndexFrom + i + 1}</td>
              <td className="py-2 px-2 font-bold">{o.plataforma === "B" ? "BET" : o.plataforma === "G" ? "GANA" : o.plataforma}</td>
              <td className={`py-2 px-2 font-bold ${o.tipo === "carga" ? "text-emerald-400" : "text-rose-400"}`}>{o.tipo === "carga" ? "Venta" : "Premio"}</td>
              <td className="py-2 px-2 text-right">{money(num(o.monto))}</td>
              <td className="py-2 px-2 text-right text-slate-500">{o.bono ? money(num(o.bono)) : "—"}</td>
              <td className="py-2 px-2 text-slate-400">{o.origen || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const bet = ops.filter((o) => o.plataforma === "B");
  const gana = ops.filter((o) => o.plataforma === "G");
  const otras = ops.filter((o) => o.plataforma !== "B" && o.plataforma !== "G");

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-slate-950 pt-1 pb-3 z-10">
          <div>
            <h3 className="font-bold text-lg">Hoja de operaciones</h3>
            <p className="text-slate-500 text-xs">{data.title} · {ops.length} operaciones</p>
          </div>
          <button onClick={onClose} className="bg-white/5 ring-1 ring-white/10 rounded-lg p-2"><X size={16} /></button>
        </div>
        {!splitByPlatform ? (
          renderTable(ops)
        ) : (
          <>
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">BET — {bet.length} operaciones</p>
            {renderTable(bet)}
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">GANA — {gana.length} operaciones</p>
            {renderTable(gana)}
            {otras.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Otras — {otras.length} operaciones</p>
                {renderTable(otras)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OpsTable({ ops }) {
  if (!ops || !ops.length) return <p className="text-slate-600 italic text-[10px]">Sin operaciones cargadas en este turno.</p>;
  return (
    <div className="max-h-96 overflow-y-auto rounded-lg ring-1 ring-white/5">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-slate-900">
          <tr className="text-slate-500 text-left">
            <th className="py-1.5 px-2 font-semibold">#</th>
            <th className="py-1.5 px-2 font-semibold">Plataforma</th>
            <th className="py-1.5 px-2 font-semibold">Tipo</th>
            <th className="py-1.5 px-2 font-semibold text-right">Monto</th>
            <th className="py-1.5 px-2 font-semibold text-right">Bono</th>
            <th className="py-1.5 px-2 font-semibold">Origen</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((o, i) => (
            <tr key={o.id || i} className="border-t border-white/5">
              <td className="py-1.5 px-2 text-slate-600">{i + 1}</td>
              <td className="py-1.5 px-2 font-bold">{o.plataforma === "B" ? "BET" : o.plataforma === "G" ? "GANA" : o.plataforma}</td>
              <td className={`py-1.5 px-2 font-bold ${o.tipo === "carga" ? "text-emerald-400" : "text-rose-400"}`}>{o.tipo === "carga" ? "Venta" : "Premio"}</td>
              <td className="py-1.5 px-2 text-right">{money(num(o.monto))}</td>
              <td className="py-1.5 px-2 text-right text-slate-500">{o.bono ? money(num(o.bono)) : "—"}</td>
              <td className="py-1.5 px-2 text-slate-400">{o.origen || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlataformaBreakdown({ porPlataforma }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PLATFORMS.map((p) => {
        const d = porPlataforma[p.key];
        const neto = d.ventas - d.premios;
        return (
          <div key={p.key} className="bg-white/5 rounded-lg p-2 text-[10px]">
            <p className="text-slate-500 uppercase font-bold mb-1">{p.label}</p>
            <div className="flex justify-between"><span className="text-slate-500">Vendido</span><span className="font-bold text-emerald-400">{money(d.ventas)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Premios</span><span className="font-bold text-rose-400">{money(d.premios)}</span></div>
            {d.bono !== undefined && <div className="flex justify-between"><span className="text-slate-500">Bono dado</span><span className="font-bold text-amber-400">{money(d.bono)}</span></div>}
            <div className="flex justify-between border-t border-white/10 mt-1 pt-1"><span className="text-slate-400 font-semibold">Neto</span><span className={`font-black ${neto >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(neto)}</span></div>
          </div>
        );
      })}
    </div>
  );
}

function ShiftRow({ c, expanded, onToggle, onDelete, onOpenOps, adminPin, onChange }) {
  const s = c.shift;
  const ok = !c.hasError;
  return (
    <div className="bg-white/[0.03] ring-1 ring-white/5 rounded-2xl mb-2 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-3.5 text-left">
        <div className="flex items-center gap-2.5">
          {expanded ? <ChevronDown size={15} className="text-slate-500" /> : <ChevronRight size={15} className="text-slate-500" />}
          <div>
            <p className="font-bold text-sm">
              {s.fecha} · {s.turno_label} ({s.hora_inicio}{s.hora_fin ? ` → ${s.hora_fin}` : ""}) · <span className="text-indigo-300">{s.responsable}</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Ventas {money(c.ventasTotal)} · Neto{" "}
              <span className={`font-bold ${c.netoCaja >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(c.netoCaja)}</span>
              {" "}· {c.opsCount} registros
              {s.excluir_arrastre && <span className="text-amber-400 font-bold"> · excluido del arrastre</span>}
            </p>
          </div>
        </div>
        {ok ? <CheckCircle2 size={16} className="text-emerald-400 flex-none" /> : <AlertTriangle size={16} className="text-amber-400 flex-none" />}
      </button>
      {expanded && (
        <div className="px-3.5 pb-4 pt-1 border-t border-white/5 text-xs space-y-3">
          <PlataformaBreakdown porPlataforma={c.porPlataforma} />
          <p className="text-slate-400">Nuevos: {c.nuevos} · Derivados: {c.derivados} · De la lista: {c.cargasLista} ({money(c.montoLista)})</p>
          <div>
            <p className="text-slate-500 mb-1 font-semibold">
              Billeteras — inicio → cierre · total al cierre <span className="text-slate-200">{money(c.billCierreTotal)}</span>
            </p>
            <div className="grid grid-cols-2 gap-1">
              {Object.keys({ ...(s.bill_inicio || {}), ...(s.bill_cierre || {}) }).map((w) => (
                <p key={w} className="text-slate-400 flex justify-between bg-black/20 rounded px-2 py-1">
                  <span>{w}</span><span>{money(num((s.bill_inicio || {})[w]))} → <b className="text-slate-200">{money(num((s.bill_cierre || {})[w]))}</b></span>
                </p>
              ))}
            </div>
          </div>
          <div>
            <p className="text-slate-500 mb-1 font-semibold">Fichas — inicio → cierre</p>
            <div className="grid grid-cols-2 gap-1">
              {PLATFORMS.map((p) => (
                <p key={p.key} className="text-slate-400 flex justify-between bg-black/20 rounded px-2 py-1">
                  <span>{p.label}</span><span>{money(num((s.stock_inicio || {})[p.key]))} → <b className="text-slate-200">{money(num((s.stock_cierre || {})[p.key]))}</b></span>
                </p>
              ))}
            </div>
          </div>
          {(s.bajadas || []).length > 0 && (
            <div>
              <p className="text-slate-500 mb-1 font-semibold">Bajadas ({s.bajadas.length}) — total {money(c.bajadasTotal)}</p>
              {s.bajadas.map((b, i) => (<p key={i} className="text-slate-400">{b.billetera} — {money(num(b.monto))} → {b.destino || "sin destino"} {b.nota && `· ${b.nota}`}</p>))}
            </div>
          )}
          {(s.movs || []).length > 0 && (
            <div>
              <p className="text-slate-500 mb-1 font-semibold">Movimientos ({s.movs.length})</p>
              {s.movs.map((m, i) => (<p key={i} className="text-slate-400">{m.tipo} · {m.plataforma} · {money(num(m.monto))} {m.nota && `· ${m.nota}`}</p>))}
            </div>
          )}
          {s.notas && <div><p className="text-slate-500 mb-1 font-semibold">Notas</p><p className="italic text-slate-300">{s.notas}</p></div>}
          {c.hasErrorRaw && (
            <div className="bg-amber-500/10 ring-1 ring-amber-500/30 rounded-xl p-3">
              <p className="text-amber-400 font-bold mb-1.5 flex items-center gap-1.5">⚠️ Dónde está la diferencia</p>
              <div className="space-y-1.5 text-[11px]">
                {c.efectivoErrorRaw && (
                  <div className="flex items-center justify-between gap-2">
                    <p>
                      <span className="text-slate-400">Efectivo:</span>{" "}
                      <span className={`font-bold ${c.diffEfectivo > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {c.diffEfectivo > 0 ? "sobran " : "faltan "}{money(Math.abs(c.diffEfectivo))}
                      </span>
                      {" "}respecto a lo esperado
                      {s.error_justificado?.efectivo && <span className="text-slate-500 italic"> · justificado</span>}
                    </p>
                    <button
                      onClick={async () => {
                        await supabase.rpc("admin_justify_shift", { input_admin_pin: adminPin, target_id: s.id, campo: "efectivo", justificado: !s.error_justificado?.efectivo });
                        onChange();
                      }}
                      className="text-[10px] font-bold text-indigo-300 underline flex-none"
                    >
                      {s.error_justificado?.efectivo ? "Deshacer" : "Justificar"}
                    </button>
                  </div>
                )}
                {PLATFORMS.map((p) => {
                  const d = c.diffFichas[p.key];
                  if (!c.fichasErrorRaw[p.key]) return null;
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-2">
                      <p>
                        <span className="text-slate-400">Fichas {p.label}:</span>{" "}
                        <span className={`font-bold ${d > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {d > 0 ? "sobran " : "faltan "}{Math.round(Math.abs(d)).toLocaleString("es-AR")}
                        </span>
                        {" "}respecto a lo esperado
                        {s.error_justificado?.[p.key] && <span className="text-slate-500 italic"> · justificado</span>}
                      </p>
                      <button
                        onClick={async () => {
                          await supabase.rpc("admin_justify_shift", { input_admin_pin: adminPin, target_id: s.id, campo: p.key, justificado: !s.error_justificado?.[p.key] });
                          onChange();
                        }}
                        className="text-[10px] font-bold text-indigo-300 underline flex-none"
                      >
                        {s.error_justificado?.[p.key] ? "Deshacer" : "Justificar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <button
              onClick={() => onOpenOps({ title: `${s.responsable} · ${s.fecha} · ${s.turno_label}`, ops: s.ops, live: false })}
              className="text-indigo-300 font-bold underline flex items-center gap-1"
            >
              Hoja de operaciones ({(s.ops || []).length}) <ChevronRight size={13} />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={async () => {
                await supabase.from("shifts").update({ excluir_arrastre: !s.excluir_arrastre, updated_at: new Date().toISOString() }).eq("id", s.id);
                onChange();
              }}
              className="text-amber-400 text-[11px] font-bold flex items-center gap-1"
              title="Saca (o vuelve a poner) este cierre como base del próximo turno, sin tocar sus estadísticas."
            >
              <Wallet size={12} /> {s.excluir_arrastre ? "Volver a usar como base del arrastre" : "Excluir del arrastre (billeteras/fichas mal cerradas)"}
            </button>
            <button
              onClick={() => { if (window.confirm(`¿Archivar este turno de ${s.responsable} (${s.fecha})? Deja de aparecer en las listas, pero queda guardado — no se pierde.`)) onDelete(s.id); }}
              className="text-rose-400 text-[11px] font-bold flex items-center gap-1"
            >
              <X size={12} /> Archivar este turno (prueba / error de carga)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeManager({ employees, adminPin, onChange }) {
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [editRecibeLeads, setEditRecibeLeads] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRecibeLeads, setNewRecibeLeads] = useState(true);

  function startEdit(e) { setEditing(e.id); setEditName(e.nombre); setEditPin(e.pin); setEditRecibeLeads(e.recibe_leads !== false); }
  async function commitEdit() {
    if (!editName.trim() || editPin.length !== 4) return;
    const { data, error } = await supabase.rpc("admin_update_employee", { input_admin_pin: adminPin, target_id: editing, new_nombre: editName.trim(), new_pin: editPin, new_recibe_leads: editRecibeLeads });
    if (error) { alert("Error al editar: " + error.message); return; }
    if (data === false) { alert("No se pudo editar — revisá el PIN de admin."); return; }
    setEditing(null); onChange();
  }
  async function remove(id) {
    if (!window.confirm("¿Dar de baja a este empleado? Su PIN deja de funcionar, pero su historial de turnos pasados queda intacto.")) return;
    await supabase.rpc("admin_deactivate_employee", { input_admin_pin: adminPin, target_id: id });
    onChange();
  }
  async function reactivate(id) {
    const { data, error } = await supabase.rpc("admin_reactivate_employee", { input_admin_pin: adminPin, target_id: id });
    if (error) { alert("Error al reactivar: " + error.message); return; }
    if (data === false) { alert("No se pudo reactivar — revisá el PIN de admin."); return; }
    onChange();
  }
  async function add() {
    if (!newName.trim() || newPin.length !== 4) return;
    const { data, error } = await supabase.rpc("admin_add_employee", { input_admin_pin: adminPin, new_nombre: newName.trim(), new_pin: newPin, new_recibe_leads: newRecibeLeads });
    if (error) { alert("Error al agregar: " + error.message); return; }
    if (data === false) { alert("No se pudo agregar — revisá el PIN de admin."); return; }
    setNewName(""); setNewPin(""); setNewRecibeLeads(true); onChange();
  }

  return (
    <Card icon={<Users size={15} />} title="Empleados y PIN" subtitle={`${employees.filter((e) => e.activo).length} personas`}>
      <div className="space-y-1.5 mb-3">
        {employees.filter((e) => e.activo).map((e) => (
          <div key={e.id} className="bg-black/20 rounded-lg px-3 py-2">
            {editing === e.id ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={editName} onChange={(ev) => setEditName(ev.target.value)} className="input !py-1 flex-1 text-xs" />
                  <input value={editPin} onChange={(ev) => setEditPin(ev.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className="input !py-1 w-20 text-xs text-center tracking-widest" />
                  <button onClick={commitEdit} className="text-emerald-400 font-bold text-[10px]">OK</button>
                </div>
                <button onClick={() => setEditRecibeLeads(!editRecibeLeads)} className={`text-[10px] font-bold px-2 py-1 rounded-lg ${editRecibeLeads ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"}`}>
                  {editRecibeLeads ? "✓ Participa del reparto de leads" : "No recibe leads (ej: no manda mensajes)"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs font-semibold">{e.nombre}</span>
                {e.recibe_leads === false && <span className="text-[9px] bg-white/5 text-slate-500 rounded-full px-2 py-0.5">sin leads</span>}
                <span className="text-slate-500 text-xs tracking-widest">{e.pin}</span>
                <button onClick={() => startEdit(e)} className="text-slate-600 hover:text-indigo-300"><Pencil size={13} /></button>
                <button onClick={() => remove(e.id)} className="text-slate-600 hover:text-rose-400"><X size={13} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mb-1.5">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre" className="input flex-1 text-xs" />
        <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="PIN" className="input w-20 text-xs text-center tracking-widest" />
        <button onClick={add} className="bg-white/5 ring-1 ring-white/10 rounded-lg px-3 flex items-center"><Plus size={14} /></button>
      </div>
      <button onClick={() => setNewRecibeLeads(!newRecibeLeads)} className={`text-[10px] font-bold px-2 py-1 rounded-lg ${newRecibeLeads ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-slate-500"}`}>
        {newRecibeLeads ? "✓ El nuevo participa del reparto de leads" : "El nuevo no recibe leads"}
      </button>
      {employees.filter((e) => !e.activo).length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <p className="text-[10px] text-slate-500 font-semibold mb-2">Dados de baja — reactivar en vez de agregar de nuevo</p>
          <div className="space-y-1.5">
            {employees.filter((e) => !e.activo).map((e) => (
              <div key={e.id} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-400">{e.nombre}</span>
                <button onClick={() => reactivate(e.id)} className="text-[10px] font-bold text-emerald-400">Reactivar</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function WalletManager({ wallets, adminPin, onChange }) {
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [newWallet, setNewWallet] = useState("");

  function startEdit(w) { setEditing(w.id); setEditValue(w.nombre); }
  async function commitEdit() {
    if (!editValue.trim()) return;
    await supabase.rpc("admin_rename_wallet", { input_admin_pin: adminPin, target_id: editing, nuevo_nombre: editValue.trim() });
    setEditing(null); onChange();
  }
  async function remove(id) {
    if (!window.confirm("¿Borrar esta billetera de la lista?")) return;
    await supabase.rpc("admin_delete_wallet", { input_admin_pin: adminPin, target_id: id });
    onChange();
  }
  async function add() {
    if (!newWallet.trim()) return;
    await supabase.rpc("admin_add_wallet", { input_admin_pin: adminPin, nombre: newWallet.trim() });
    setNewWallet(""); onChange();
  }

  return (
    <Card icon={<Wallet size={15} />} title="Billeteras configuradas" subtitle={`${wallets.length} en uso`}>
      <div className="space-y-1.5 mb-3 max-h-80 overflow-y-auto">
        {wallets.map((w) => (
          <div key={w.id} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
            {editing === w.id ? (
              <input value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commitEdit()} onBlur={commitEdit} autoFocus className="input !py-1 flex-1 text-xs" />
            ) : (
              <span className="flex-1 text-xs font-semibold">{w.nombre}</span>
            )}
            <button onClick={() => startEdit(w)} className="text-slate-600 hover:text-indigo-300"><Pencil size={13} /></button>
            <button onClick={() => remove(w.id)} className="text-slate-600 hover:text-rose-400"><X size={13} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={newWallet} onChange={(e) => setNewWallet(e.target.value)} placeholder="Nueva billetera" className="input flex-1 text-xs" />
        <button onClick={add} className="bg-white/5 ring-1 ring-white/10 rounded-lg px-3 flex items-center"><Plus size={14} /></button>
      </div>
    </Card>
  );
}

function BasesAdmin({ employees, dbs, dbStats, reactivables, allContactsFlat, poolDisponible, adminPin, onChange }) {
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseFuente, setNewBaseFuente] = useState("masiva");
  const [cupo, setCupo] = useState("35");
  const [cupoSaved, setCupoSaved] = useState(false);
  const [fileRef, setFileRef] = useState(null);
  const [importTargetBase, setImportTargetBase] = useState("");
  const [eventsBase, setEventsBase] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_config").select("value").eq("key", "cupo_diario_leads").single();
      if (data) setCupo(data.value);
    })();
  }, []);

  async function saveCupo() {
    await supabase.from("app_config").update({ value: String(parseInt(cupo, 10) || 35) }).eq("key", "cupo_diario_leads");
    setCupoSaved(true); setTimeout(() => setCupoSaved(false), 1500);
  }

  async function createBase() {
    const nombre = newBaseName.trim() || `Lista ${todayStr()}`;
    await supabase.rpc("admin_create_base", { input_admin_pin: adminPin, nombre, tipo_fuente: newBaseFuente });
    setNewBaseName(""); onChange();
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file || !importTargetBase) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      const sep = lines[0].includes(",") ? "," : lines[0].includes("\t") ? "\t" : ";";
      let start = 0;
      if (/nombre/i.test(lines[0])) start = 1;
      const rows = [];
      for (let i = start; i < lines.length; i++) {
        const parts = lines[i].split(sep).map((p) => p.trim());
        if (!parts[0]) continue;
        rows.push({ nombre: parts[0], numero: parts[1] || "" });
      }
      if (rows.length) {
        await supabase.rpc("admin_import_contacts", { input_admin_pin: adminPin, target_base: importTargetBase, rows });
        onChange();
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function viewEvents(baseId, baseNombre) {
    setEventsBase({ id: baseId, nombre: baseNombre });
    const { data } = await supabase.rpc("admin_list_events", { input_admin_pin: adminPin, target_base_id: baseId });
    setEvents(data || []);
  }

  return (
    <>
      {reactivables.length > 0 && (
        <Card icon={<Sparkles size={15} />} title="Para reactivar" subtitle={`${reactivables.length} contactos que ya cargaron y llevan ${REACTIVACION_DIAS}+ días sin que nadie los toque`}>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {reactivables.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-amber-500/10 ring-1 ring-amber-500/20 rounded-lg px-2.5 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{c.nombre} <span className="text-slate-500 font-normal">· {c.base_nombre}</span></p>
                  <p className="text-[10px] text-slate-500">{c.numero || "sin número"} · último contacto hace {daysSince(c.ultimo_contacto)} días</p>
                </div>
                <button
                  onClick={async () => {
                    await supabase.rpc("admin_mark_seguimiento", { input_admin_pin: adminPin, target_id: c.id });
                    onChange();
                  }}
                  className="text-[10px] font-bold text-amber-400 flex-none ml-2"
                >
                  Marcar en seguimiento
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card icon={<Database size={15} />} title="Crear base nueva" subtitle="Solo vos podés crear bases">
        <div className="flex gap-1.5 mb-2">
          {FUENTE_TYPES.map((f) => (
            <button
              key={f.key} onClick={() => setNewBaseFuente(f.key)}
              className={`flex-1 rounded-lg py-2 text-[10px] font-bold ${newBaseFuente === f.key ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-400"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mb-2">{FUENTE_TYPES.find((f) => f.key === newBaseFuente)?.hint}</p>
        <div className="flex gap-1.5">
          <input value={newBaseName} onChange={(e) => setNewBaseName(e.target.value)} placeholder={`Base nueva (ej: Lista ${todayStr()})`} className="input flex-1 text-xs" />
          <button onClick={createBase} className="bg-white/5 ring-1 ring-white/10 rounded-lg px-3 flex items-center gap-1 text-xs font-bold"><Plus size={13} /> Crear</button>
        </div>
      </Card>

      <Card icon={<Upload size={15} />} title="Subir contactos a una base">
        <div className="flex gap-1.5 mb-2">
          <select value={importTargetBase} onChange={(e) => setImportTargetBase(e.target.value)} className="input flex-1 !py-1.5 text-xs">
            <option value="">Elegí la base destino</option>
            {dbs.map((d) => (<option key={d.id} value={d.id}>{d.nombre}</option>))}
          </select>
        </div>
        <input type="file" accept=".csv,.txt" disabled={!importTargetBase} onChange={handleFile} className="text-xs text-slate-400" />
        <p className="text-[10px] text-slate-600 mt-2">Archivo .csv o .txt, una línea por contacto: nombre,número</p>
      </Card>

      <Card icon={<Users size={15} />} title="Reparto automático" subtitle="Cada empleado recibe contactos solo hasta este cupo, tomados del pool compartido">
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-white/5 rounded-xl px-3 py-2 flex-1 text-center">
            <p className="text-[9px] text-slate-500 uppercase">Disponibles en el pool</p>
            <p className="text-lg font-black text-emerald-400">{poolDisponible}</p>
          </div>
          <div className="bg-white/5 rounded-xl px-3 py-2 flex-1 text-center">
            <p className="text-[9px] text-slate-500 uppercase">Empleados activos</p>
            <p className="text-lg font-black">{employees.filter((e) => e.activo).length}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mb-1.5 font-semibold">Cupo diario por empleado</p>
        <div className="flex gap-1.5">
          <input value={cupo} onChange={(e) => setCupo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="input flex-1 !py-1.5 text-xs" />
          <button onClick={saveCupo} className="bg-gradient-to-r from-indigo-500 to-violet-600 rounded-lg px-3 text-xs font-bold">{cupoSaved ? "✓ Guardado" : "Guardar"}</button>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Ya no hace falta asignar bases a mano: cuando un empleado entra a Bases, el sistema le arma su lista de hoy solo, respetando el horario real de cada uno — "Inactivos" y "Comprada" van parejos, y "Masiva" entra siempre en una porción chica (ajustable abajo) para no descuidarla nunca del todo.
        </p>
      </Card>

      <Card icon={<Upload size={15} />} title="Reportes — exportar por estado" subtitle="Se descarga como CSV, se abre directo en Excel">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => downloadCsv(`enviados_${todayStr()}.csv`, allContactsFlat.filter((c) => (c.estado || "nuevo") === "contactado"), CSV_HEADERS)}
            className="bg-white/5 ring-1 ring-white/10 rounded-lg py-2 text-[10px] font-bold text-center"
          >
            Enviados<br /><span className="text-slate-500 font-normal">(sin respuesta)</span>
          </button>
          <button
            onClick={() => downloadCsv(`contestados_${todayStr()}.csv`, allContactsFlat.filter((c) => ["contestado", "interesado"].includes(c.estado)), CSV_HEADERS)}
            className="bg-white/5 ring-1 ring-white/10 rounded-lg py-2 text-[10px] font-bold text-center"
          >
            Contestados<br /><span className="text-slate-500 font-normal">(sin cargar aún)</span>
          </button>
          <button
            onClick={() => downloadCsv(`cargaron_${todayStr()}.csv`, allContactsFlat.filter((c) => c.estado === "cargado"), CSV_HEADERS)}
            className="bg-white/5 ring-1 ring-white/10 rounded-lg py-2 text-[10px] font-bold text-center"
          >
            Cargaron<br /><span className="text-slate-500 font-normal">(convertidos)</span>
          </button>
        </div>
      </Card>

      <Card icon={<Database size={15} />} title="Resultados por base de datos">
        {dbs.length === 0 && <p className="text-slate-600 text-xs italic">No hay bases creadas todavía.</p>}
        {dbs.map((d) => {
          const s = dbStats[d.id] || { total: 0, enviados: 0, contestados: 0, cargaron: 0, agregadosPorEmpleado: [] };
          return (
            <div key={d.id} className="py-2.5 border-b border-white/5 last:border-0">
              <div className="flex items-center justify-between">
                <p className="font-bold text-sm">{d.nombre}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => viewEvents(d.id, d.nombre)} className="text-[10px] text-indigo-300 font-bold">Ver historial</button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`¿Borrar la base "${d.nombre}"? Se van a borrar también sus ${s.total} contactos. No se puede deshacer.`)) return;
                      await supabase.rpc("admin_delete_base", { input_admin_pin: adminPin, target_id: d.id });
                      onChange();
                    }}
                    className="text-[10px] text-rose-400 font-bold"
                  >
                    Borrar
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-1.5">{DB_TYPES[d.tipo]}</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="Contactos" value={s.total} />
                <MiniStat label="Enviados" value={s.enviados} />
                <MiniStat label="Contestados" value={s.contestados} pct={s.enviados ? Math.round((s.contestados / s.enviados) * 100) : 0} />
                <MiniStat label="Cargaron" value={s.cargaron} pct={s.contestados ? Math.round((s.cargaron / s.contestados) * 100) : 0} />
              </div>
              {s.agregadosPorEmpleado.length > 0 && (
                <div className="mt-2 bg-amber-500/10 ring-1 ring-amber-500/20 rounded-lg px-2.5 py-2">
                  <p className="text-[10px] font-bold text-amber-400 mb-1">{s.agregadosPorEmpleado.length} agregado(s) por empleados — para revisar</p>
                  {s.agregadosPorEmpleado.slice(0, 5).map((c) => (<p key={c.id} className="text-[10px] text-slate-400">{c.nombre} · agregado por {c.agregado_por}</p>))}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {eventsBase && (
        <Card icon={<Sparkles size={15} />} title={`Historial — ${eventsBase.nombre}`} subtitle="Respaldo permanente de toda la actividad de esta base" right={<button onClick={() => setEventsBase(null)} className="text-slate-500"><X size={14} /></button>}>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {events.length === 0 && <p className="text-slate-600 text-xs italic">Sin actividad registrada.</p>}
            {events.map((ev) => (
              <p key={ev.id} className="text-[10px] text-slate-400">{new Date(ev.created_at).toLocaleString("es-AR")} · <span className="text-slate-300 font-semibold">{ev.empleado}</span> · {ev.accion}</p>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function ClientesRanking({ computedAll }) {
  const [rangeKey, setRangeKey] = useState("todo");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function applyPreset(key) {
    setRangeKey(key);
    const today = todayStr();
    if (key === "hoy") { setDateFrom(today); setDateTo(today); }
    else if (key === "7d") { const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); }
    else if (key === "mes") { const d = new Date(); d.setDate(1); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today); }
    else if (key === "todo") { setDateFrom(""); setDateTo(""); }
  }

  const ranking = useMemo(() => {
    const map = {};
    computedAll.forEach((c) => {
      const s = c.shift;
      if (dateFrom && s.fecha < dateFrom) return;
      if (dateTo && s.fecha > dateTo) return;
      (s.ops || []).forEach((o) => {
        const cliente = (o.cliente || "").trim();
        if (!cliente) return;
        const m = num(o.monto);
        if (!map[cliente]) map[cliente] = { cargas: 0, premios: 0, ops: 0, ultima: s.fecha };
        if (o.tipo === "carga") map[cliente].cargas += m; else map[cliente].premios += m;
        map[cliente].ops++;
        if (s.fecha > map[cliente].ultima) map[cliente].ultima = s.fecha;
      });
    });
    return Object.entries(map)
      .map(([cliente, d]) => ({ cliente, ...d, neto: d.cargas - d.premios }))
      .sort((a, b) => b.neto - a.neto);
  }, [computedAll, dateFrom, dateTo]);

  const sinDato = computedAll.every((c) => (c.shift.ops || []).every((o) => !o.cliente));

  return (
    <>
      <DateRangeFilter rangeKey={rangeKey} dateFrom={dateFrom} dateTo={dateTo} onPreset={applyPreset} onFrom={(v) => { setRangeKey("custom"); setDateFrom(v); }} onTo={(v) => { setRangeKey("custom"); setDateTo(v); }} />

      {sinDato ? (
        <Card icon={<Users size={15} />} title="Todavía no hay datos de clientes" subtitle="Se arma solo a medida que se completa el campo 'Cliente' en Operaciones">
          <p className="text-slate-500 text-xs">Es un campo opcional — apenas empiecen a completarlo (aunque sea de a poco), acá va a aparecer el ranking real de quién te deja más plata.</p>
        </Card>
      ) : (
        <Card icon={<Users size={15} />} title="Ranking de clientes" subtitle={`${ranking.length} identificados en el período`}>
          <div className="space-y-1.5 max-h-[32rem] overflow-y-auto">
            {ranking.map((r, i) => (
              <div key={r.cliente} className="flex items-center justify-between bg-white/[0.02] ring-1 ring-white/5 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-600 font-bold w-5 flex-none">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="font-bold truncate">···{r.cliente}</p>
                    <p className="text-[10px] text-slate-500">{r.ops} operaciones · última {r.ultima}</p>
                  </div>
                </div>
                <p className={`font-black flex-none ${r.neto >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(r.neto)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
