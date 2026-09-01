import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { PLATFORMS, num, todayStr, nowStr, classifyTurno, seedOps, SEED_ROWS } from "./lib";

// Este hook mantiene el turno del empleado como una fila real en la tabla `shifts`
// de Supabase, status='abierto', desde el momento en que se identifica hasta que
// cierra. Se autoguarda cada pocos segundos. Admin lee esa misma fila para ver todo
// en vivo. Al cerrar, pasa a status='cerrado' y queda como historial permanente.
export function useTurnoDraft(identity) {
  const [shiftId, setShiftId] = useState(null);
  const [ready, setReady] = useState(false);
  const [carriedFrom, setCarriedFrom] = useState(null);
  // Si ya hay un turno abierto a nombre de OTRA persona, no se abre uno nuevo:
  // guarda quién lo tiene abierto para avisarle al resto en vez de duplicar la caja.
  const [otherOpenBy, setOtherOpenBy] = useState(null);
  // Si la persona tiene su sesión de refuerzo abierta (todavía no tocó "Cerrar
  // sesión" en Bases), no puede abrir Turno bajo ningún caso — sin importar si el
  // principal ya cerró su caja o no. Evita que alguien "tome" la caja sin querer.
  const [refuerzoPropioAbierto, setRefuerzoPropioAbierto] = useState(false);

  const [meta, setMeta] = useState({ fecha: todayStr(), horaInicio: nowStr(), horaFin: "", responsable: "" });
  const [billInicio, setBillInicio] = useState({});
  const [billCierre, setBillCierre] = useState({});
  const [stockInicio, setStockInicio] = useState({ B: "", G: "" });
  const [stockCierreInf, setStockCierreInf] = useState({ B: "", G: "" });
  const [ops, setOps] = useState(() => seedOps(SEED_ROWS));
  const [bajadas, setBajadas] = useState([]);
  const [movs, setMovs] = useState([]);
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const draftRef = useRef(null);

  // Al identificarse: retoma un turno abierto propio si ya existía (ej. se refrescó la
  // página a mitad de turno), o si no, arrastra el cierre más reciente y crea uno nuevo.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      setReady(false);
      setOtherOpenBy(null);
      setRefuerzoPropioAbierto(false);
      const { data: mine } = await supabase
        .from("shifts").select("*").eq("status", "abierto").eq("archivado", false).eq("responsable", identity.nombre)
        .order("created_at", { ascending: false }).limit(1);
      if (cancelled) return;
      if (mine && mine.length) {
        const s = mine[0];
        setShiftId(s.id);
        setMeta({ fecha: s.fecha, horaInicio: s.hora_inicio?.slice(0, 5) || nowStr(), horaFin: "", responsable: s.responsable });
        setBillInicio(s.bill_inicio || {}); setBillCierre(s.bill_cierre || {});
        setStockInicio(s.stock_inicio || { B: "", G: "" }); setStockCierreInf(s.stock_cierre || { B: "", G: "" });
        setOps((s.ops && s.ops.length ? s.ops : seedOps(SEED_ROWS)));
        setBajadas(s.bajadas || []); setMovs(s.movs || []); setNotas(s.notas || "");
        // (ya no se usa mensajes_enviados)
        setReady(true);
        return;
      }
      // No tengo turno propio abierto todavía. Si estoy trabajando como refuerzo
      // (sesión de refuerzo sin cerrar), no puedo abrir uno nuevo — tiene que cerrar
      // su sesión de refuerzo en Bases primero. Esto es así aunque el principal ya
      // haya cerrado su caja: evita que alguien "tome" la caja a medio camino.
      if (identity.token) {
        const { data: esRefuerzo } = await supabase.rpc("tiene_refuerzo_abierto", { input_token: identity.token });
        if (cancelled) return;
        if (esRefuerzo) {
          setRefuerzoPropioAbierto(true);
          setReady(true);
          return;
        }
      }
      // No tengo turno propio abierto. Antes de crear uno, me fijo si YA hay un turno
      // abierto a nombre de otra persona: si lo hay, no creo uno nuevo (evita duplicar
      // la caja y que dos personas escriban el mismo turno a la vez).
      const { data: anyOpen } = await supabase
        .from("shifts").select("*").eq("status", "abierto").eq("archivado", false)
        .order("created_at", { ascending: false }).limit(1);
      if (cancelled) return;
      if (anyOpen && anyOpen.length) {
        setOtherOpenBy({ nombre: anyOpen[0].responsable, hora: anyOpen[0].hora_inicio });
        setReady(true);
        return;
      }
      // CAMBIO 1: se agregó .not("cerrado_at", "is", null) — así el sistema ignora
      // cualquier turno que haya quedado marcado "cerrado" pero sin fecha de cierre
      // real cargada (por ejemplo, turnos de prueba mal cerrados). Sin esto, esos
      // turnos "fantasma" podían colarse como si fueran el último cierre válido.
      const { data: lastClosed } = await supabase
        .from("shifts").select("*").eq("status", "cerrado").eq("archivado", false)
        .not("cerrado_at", "is", null)
        .order("cerrado_at", { ascending: false, nullsFirst: false }).limit(1);
      const prev = lastClosed && lastClosed[0];
      const carriedBill = prev ? prev.bill_cierre || {} : {};
      const carriedStock = prev ? prev.stock_cierre || { B: "", G: "" } : { B: "", G: "" };
      if (prev) setCarriedFrom({ fecha: prev.fecha, hora: prev.hora_fin || prev.hora_inicio, responsable: prev.responsable });
      else setCarriedFrom(null);

      const horaInicio = nowStr();
      const { data: created, error: insErr } = await supabase
        .from("shifts")
        .insert({
          fecha: todayStr(), hora_inicio: horaInicio, responsable: identity.nombre,
          turno_label: classifyTurno(horaInicio),
          bill_inicio: carriedBill, stock_inicio: carriedStock,
          status: "abierto",
        })
        .select().single();
      if (cancelled) return;
      if (insErr) { setError("No se pudo abrir el turno: " + insErr.message); setReady(true); return; }
      setShiftId(created.id);
      setMeta({ fecha: created.fecha, horaInicio, horaFin: "", responsable: identity.nombre });
      setBillInicio(carriedBill); setStockInicio(carriedStock);
      setBillCierre({}); setStockCierreInf({ B: "", G: "" });
      setOps(seedOps(SEED_ROWS)); setBajadas([]); setMovs([]); setNotas("");
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [identity]);

  const opsFilled = ops.filter((o) => o.monto !== "");

  const expected = useMemo(() => {
    const porPlataforma = { B: { carga: 0, retiro: 0, bono: 0 }, G: { carga: 0, retiro: 0, bono: 0 } };
    opsFilled.forEach((o) => {
      const m = num(o.monto);
      if (o.tipo === "carga") { porPlataforma[o.plataforma].carga += m; porPlataforma[o.plataforma].bono += num(o.bono); }
      else porPlataforma[o.plataforma].retiro += m;
    });
    const res = {};
    PLATFORMS.forEach((p) => {
      const stockIni = num(stockInicio[p.key]);
      const mov = movs.filter((m) => m.plataforma === p.key).reduce((s, m) => s + num(m.monto), 0);
      res[p.key] = stockIni - porPlataforma[p.key].carga - porPlataforma[p.key].bono + porPlataforma[p.key].retiro + mov;
    });
    const ventasTotal = porPlataforma.B.carga + porPlataforma.G.carga;
    const retirosTotal = porPlataforma.B.retiro + porPlataforma.G.retiro;
    const bajadasTotal = bajadas.reduce((s, b) => s + num(b.monto), 0);
    const billInicioTotal = Object.values(billInicio).reduce((s, v) => s + num(v), 0);
    const efectivoEsperado = billInicioTotal + ventasTotal - retirosTotal - bajadasTotal;
    return { stock: res, efectivoEsperado, ventasTotal, retirosTotal };
  }, [opsFilled, movs, stockInicio, billInicio, bajadas]);

  const cierreCheck = useMemo(() => {
    const billCierreTotal = Object.values(billCierre).reduce((s, v) => s + num(v), 0);
    const diffEfectivo = billCierreTotal - expected.efectivoEsperado;
    const diffFichas = {};
    PLATFORMS.forEach((p) => { diffFichas[p.key] = num(stockCierreInf[p.key]) - expected.stock[p.key]; });
    const anyCierreData = billCierreTotal !== 0 || Object.values(stockCierreInf).some((v) => v !== "");
    return { diffEfectivo, diffFichas, anyCierreData };
  }, [billCierre, stockCierreInf, expected]);

  draftRef.current = { meta, billInicio, billCierre, stockInicio, stockCierreInf, opsFilled, bajadas, movs, notas };

  // Autoguardado cada 6s mientras el turno sigue abierto — así Admin lo ve en vivo
  // sin que dependa de que el empleado toque nada.
  useEffect(() => {
    if (!shiftId || !ready) return;
    const push = async () => {
      const d = draftRef.current;
      await supabase.from("shifts").update({
        bill_inicio: d.billInicio, bill_cierre: d.billCierre,
        stock_inicio: d.stockInicio, stock_cierre: d.stockCierreInf,
        ops: d.opsFilled, bajadas: d.bajadas, movs: d.movs, notas: d.notas,
        updated_at: new Date().toISOString(),
      }).eq("id", shiftId);
    };
    const interval = setInterval(push, 6000);
    return () => clearInterval(interval);
  }, [shiftId, ready]);

  async function submitTurno() {
    if (!shiftId) return;

    // CAMBIO 2: antes de permitir cerrar el turno, se exige que TODAS las
    // billeteras que arrancó el turno (billInicio) tengan su valor de cierre
    // cargado, y que las fichas de cierre de ambas plataformas (B y G) estén
    // completas. Si falta algo, no se guarda y se le avisa al empleado qué
    // falta — así ningún turno vuelve a quedar "cerrado" sin caja ni fichas
    // cargadas (como pasó con el turno de prueba que generó el problema).
    const billKeys = Object.keys(billInicio);
    const billCierreCompleto = billKeys.length === 0 || billKeys.every(
      (k) => billCierre[k] !== undefined && billCierre[k] !== "" && billCierre[k] !== null
    );
    const stockCierreCompleto = stockCierreInf.B !== "" && stockCierreInf.G !== "";

    if (!billCierreCompleto || !stockCierreCompleto) {
      setError("Antes de cerrar el turno tenés que cargar todas las billeteras y las fichas de cierre (B y G).");
      return false;
    }

    setSaving(true);
    setError("");
    const { error: updErr } = await supabase.from("shifts").update({
      status: "cerrado",
      hora_fin: nowStr(),
      turno_label: classifyTurno(meta.horaInicio),
      bill_inicio: billInicio, bill_cierre: billCierre,
      stock_inicio: stockInicio, stock_cierre: stockCierreInf,
      ops: opsFilled, bajadas, movs, notas,
      updated_at: new Date().toISOString(),
      cerrado_at: new Date().toISOString(),
    }).eq("id", shiftId);
    setSaving(false);
    if (updErr) { setError("No se pudo cerrar el turno: " + updErr.message); return false; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setShiftId(null);
    return true;
  }

  return {
    ready, carriedFrom, otherOpenBy, refuerzoPropioAbierto, meta, setMeta, billInicio, billCierre, setBillCierre,
    stockInicio, stockCierreInf, setStockCierreInf, ops, setOps,
    bajadas, setBajadas, movs, setMovs, notas, setNotas,
    expected, cierreCheck,
    saving, error, saved, submitTurno, opsFilledCount: opsFilled.length,
  };
}
