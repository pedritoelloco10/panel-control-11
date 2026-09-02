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
  // A diferencia de `error` (que es sobre acciones puntuales — abrir/cerrar turno),
  // esto refleja si el autoguardado periódico está funcionando. Antes fallaba en
  // silencio: si se cortaba la conexión un rato, esos cambios se perdían sin que
  // nadie se enterara hasta mucho después.
  const [autosaveError, setAutosaveError] = useState(false);

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
      // Se ignora cualquier turno que haya quedado marcado "cerrado" pero sin fecha de
      // cierre real cargada (por ejemplo, turnos de prueba mal cerrados). Sin esto, esos
      // turnos "fantasma" podían colarse como si fueran el último cierre válido.
      // También se ignora cualquier turno marcado excluir_arrastre=true: es la forma en
      // que Admin saca un cierre puntual (con billeteras/fichas mal cargadas) de la
      // cadena de arrastre sin tener que archivar todo el turno y perderlo de las
      // estadísticas. .not(..., "is", true) trata NULL igual que false (lo incluye).
      const { data: lastClosed } = await supabase
        .from("shifts").select("*").eq("status", "cerrado").eq("archivado", false)
        .not("cerrado_at", "is", null)
        .not("excluir_arrastre", "is", true)
        .order("cerrado_at", { ascending: false, nullsFirst: false }).limit(1);
      const prev = lastClosed && lastClosed[0];
      const carriedBill = prev ? prev.bill_cierre || {} : {};
      const carriedStock = prev ? prev.stock_cierre || { B: "", G: "" } : { B: "", G: "" };
      if (prev) setCarriedFrom({ fecha: prev.fecha, hora: prev.hora_fin || prev.hora_inicio, responsable: prev.responsable });
      else setCarriedFrom(null);

      const horaInicio = nowStr();
      // Pasa por session_open_turno (security definer) en vez de insertar
      // directo: la función valida el token del lado del servidor y arma la
      // fila con el `responsable` que le corresponde a ESE token — nadie
      // puede abrir un turno a nombre de otra persona falseando el pedido.
      const { data: created, error: insErr } = await supabase.rpc("session_open_turno", {
        input_token: identity.token,
        nueva_fecha: todayStr(),
        nueva_hora_inicio: horaInicio,
        nuevo_turno_label: classifyTurno(horaInicio),
        nuevo_bill_inicio: carriedBill,
        nuevo_stock_inicio: carriedStock,
      });
      if (cancelled) return;
      if (insErr) {
        // Carrera: alguien más abrió su turno en el mismo instante y la base
        // lo bloqueó (índice único, ver migrations/). En vez de mostrar un
        // error de SQL en crudo, nos comportamos igual que si ya lo hubiéramos
        // visto abierto — es exactamente lo que pasó, solo que nos enteramos
        // un paso más tarde.
        if (insErr.code === "23505") {
          const { data: nowOpen } = await supabase
            .from("shifts").select("*").eq("status", "abierto").eq("archivado", false)
            .order("created_at", { ascending: false }).limit(1);
          if (cancelled) return;
          if (nowOpen && nowOpen.length) setOtherOpenBy({ nombre: nowOpen[0].responsable, hora: nowOpen[0].hora_inicio });
          else setError("No se pudo abrir el turno, probá de nuevo.");
        } else {
          setError("No se pudo abrir el turno: " + insErr.message);
        }
        setReady(true);
        return;
      }
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
  // sin que dependa de que el empleado toque nada. Además de eso, guarda apenas la
  // pestaña se oculta (cambian de app, el celular se bloquea) o la página se cierra:
  // esperar el intervalo de 6s significaba poder perder justo lo último que se
  // había tipeado en ese momento — que en la práctica era la causa más común de
  // billeteras/fichas que quedaban en blanco o a medio cargar.
  useEffect(() => {
    if (!shiftId || !ready) return;
    let cancelled = false;
    const push = async () => {
      const d = draftRef.current;
      const { data: ok, error: saveErr } = await supabase.rpc("session_autosave_turno", {
        input_token: identity.token,
        target_id: shiftId,
        nuevo_bill_inicio: d.billInicio, nuevo_bill_cierre: d.billCierre,
        nuevo_stock_inicio: d.stockInicio, nuevo_stock_cierre: d.stockCierreInf,
        nuevos_ops: d.opsFilled, nuevas_bajadas: d.bajadas, nuevos_movs: d.movs, nuevas_notas: d.notas,
      });
      // `ok === false` significa que la función corrió bien pero no encontró
      // el turno como propio y abierto (sesión vencida, u otra cosa lo cerró
      // mientras tanto) — se trata igual que un error de guardado.
      if (!cancelled) setAutosaveError(!!saveErr || ok === false);
    };
    const interval = setInterval(push, 6000);
    const onVisibility = () => { if (document.hidden) push(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", push);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", push);
    };
  }, [shiftId, ready, identity]);

  async function submitTurno() {
    if (!shiftId) return;

    // Antes de permitir cerrar el turno, se exige completar el cierre de las billeteras
    // que existen HOY en el sistema (no las que había cuando el turno arrancó). Así, si
    // en el medio del turno se borró alguna billetera desde Admin, no queda pidiendo
    // completar algo que ya no aparece en pantalla y que nadie podría cargar nunca.
    const { data: currentWallets, error: walletsErr } = await supabase.from("wallets").select("nombre");
    if (walletsErr) {
      setError("No se pudo verificar las billeteras vigentes: " + walletsErr.message);
      return false;
    }
    // No alcanza con que el campo no esté vacío: tiene que ser un número de verdad.
    // Antes, cualquier valor no numérico (por ejemplo un dato corrupto o pegado mal)
    // pasaba el chequeo de "completo" y después se convertía en 0 en silencio al
    // calcularse los totales — un cierre que parecía completo pero en realidad
    // arrastraba un cero disfrazado al turno siguiente.
    const esNumero = (v) => typeof v === "string" && /^\d+$/.test(v);
    const walletNames = (currentWallets || []).map((w) => w.nombre);
    const billCierreCompleto = walletNames.length === 0 || walletNames.every((nombre) => esNumero(billCierre[nombre]));
    const stockCierreCompleto = esNumero(stockCierreInf.B) && esNumero(stockCierreInf.G);

    if (!billCierreCompleto || !stockCierreCompleto) {
      setError("Antes de cerrar el turno tenés que cargar todas las billeteras y las fichas de cierre (B y G).");
      return false;
    }

    setSaving(true);
    setError("");
    const { data: ok, error: updErr } = await supabase.rpc("session_close_turno", {
      input_token: identity.token,
      target_id: shiftId,
      nueva_hora_fin: nowStr(),
      nuevo_turno_label: classifyTurno(meta.horaInicio),
      nuevo_bill_inicio: billInicio, nuevo_bill_cierre: billCierre,
      nuevo_stock_inicio: stockInicio, nuevo_stock_cierre: stockCierreInf,
      nuevos_ops: opsFilled, nuevas_bajadas: bajadas, nuevos_movs: movs, nuevas_notas: notas,
    });
    setSaving(false);
    if (updErr || ok === false) {
      setError("No se pudo cerrar el turno" + (updErr ? ": " + updErr.message : " — probá de nuevo."));
      return false;
    }
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
    saving, error, saved, autosaveError, submitTurno, opsFilledCount: opsFilled.length,
  };
}
