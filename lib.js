export const PLATFORMS = [
  { key: "B", label: "BET" },
  { key: "G", label: "GANA" },
];
export const FUENTE_TYPES = [
  { key: "masiva", label: "Masiva", hint: "Interactuaron con publicidad" },
  { key: "principales", label: "Principales", hint: "Ya jugaron, sin hablar 7+ días" },
  { key: "comprada", label: "Comprada", hint: "Lista comprada" },
];
export const LEAD_STATES = [
  { key: "nuevo", label: "Nuevo", color: "slate" },
  { key: "contactado", label: "Contactado", color: "indigo" },
  { key: "contestado", label: "Contestó", color: "sky" },
  { key: "interesado", label: "Interesado", color: "amber" },
  { key: "cargado", label: "Cargó", color: "emerald" },
  { key: "descartado", label: "Descartado", color: "rose" },
  // Adonde va un contacto reciclado automáticamente (ver veces_reciclado) —
  // distinto tanto de "Nuevo" como de cualquier estado resuelto, a propósito.
  { key: "para_retomar", label: "Para retomar", color: "orange" },
];
export const MOTIVOS_DESCARTE = ["No contestó", "No le interesó", "Número inválido", "Ya es cliente por otro medio"];
export const REACTIVACION_DIAS = 7;
export const FUENTE_PRIORITY = { principales: 0, masiva: 1, comprada: 2 };
export function toCsv(rows, headers) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map((h) => esc(h.label)).join(",")];
  rows.forEach((r) => lines.push(headers.map((h) => esc(r[h.key])).join(",")));
  return lines.join("\n");
}
export function downloadCsv(filename, rows, headers) {
  const csv = "\uFEFF" + toCsv(rows, headers); // BOM para que Excel abra bien los acentos
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export const SEED_ROWS = 150;
export const GROW_BATCH = 20;

export function num(v) {
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
export function formatMiles(v) {
  const str = String(v ?? "");
  const neg = str.trim().startsWith("-");
  const digits = str.replace(/\D/g, "");
  if (!digits) return "";
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return neg ? "-" + formatted : formatted;
}
export function money(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n || 0)).toLocaleString("es-AR");
}
export function uid() {
  // crypto.randomUUID() (122 bits de entropía real) en vez de Date.now()+Math.random():
  // ese esquema viejo solo tenía ~5 caracteres base36 (~26 bits) de verdadera aleatoriedad,
  // porque Date.now() se repite entre llamadas hechas en el mismo milisegundo — y eso
  // pasaba seguido, porque seedOps/GROW_BATCH generan muchas filas en un mismo loop
  // síncrono. Dos filas con el mismo id hacían que escribir en una actualizara ambas.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7);
}
// Si por algún motivo dos filas de ops ya guardadas (de antes de este fix) comparten
// id, al cargarlas se les asigna un id nuevo a las repetidas — si no, quedarían
// "pegadas" para siempre (escribir en una seguiría escribiendo en la otra) aunque
// se refresque la página, porque el id duplicado ya está guardado en la base.
export function dedupeOpsIds(ops) {
  const seen = new Set();
  let changed = false;
  const next = ops.map((o) => {
    if (seen.has(o.id)) { changed = true; return { ...o, id: uid() }; }
    seen.add(o.id);
    return o;
  });
  return changed ? next : ops;
}
export function todayStr() {
  // OJO: nunca usar toISOString() acá — es siempre en UTC. Entre las 21:00 y las 23:59
  // hora Argentina (UTC-3) ya es el día siguiente en UTC, así que un turno Noche abierto
  // a esa hora quedaba fechado un día adelantado (ej: abierto 22:05 del 3/11 quedaba
  // guardado como 4/11) — se arma la fecha a mano con los componentes locales.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function nowStr() {
  return new Date().toTimeString().slice(0, 5);
}
export function classifyTurno(hora) {
  const h = parseInt((hora || "0").split(":")[0], 10);
  if (h >= 6 && h < 14) return "Mañana";
  if (h >= 14 && h < 22) return "Tarde";
  return "Noche";
}
export function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const ms = new Date(todayStr()).getTime() - new Date(dateStr).getTime();
  return Math.floor(ms / 86400000);
}
export function estadoToBooleans(estado) {
  return {
    enviado: estado !== "nuevo",
    contestado: ["contestado", "interesado", "cargado"].includes(estado),
    cargo: estado === "cargado",
  };
}
export function blankOp() {
  return { id: uid(), plataforma: "B", tipo: "carga", monto: "", bono: "", origen: null, cliente: "" };
}
export function seedOps(n) {
  return Array.from({ length: n }, blankOp);
}

// Convierte en filas estructuradas el texto pegado con las operaciones de Ganamos.
// Acepta dos formatos, detectados línea por línea:
//   1. Formato canónico (el que se le pide a la IA que lee Ganamos que genere):
//      TX | FECHA_HORA (AAAA-MM-DD HH:MM) | TIPO (Deposito/Retiro/Bonus) | USUARIO | MONTO
//   2. Tabla cruda copiada del navegador (tabs, o 2+ espacios si se pegó sin tabs):
//      TRANSACCIÓN | FECHA (dd/mm/aa hh:mm) | OPERACIÓN | INICIADOR | DE | A | CANTIDAD | SALDO
const GANAMOS_OPERACION_A_TIPO = { deposito: "carga", retiro: "retiro", bonus: "bono" };
function normalizarTexto(s) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function parsearFecha(fechaStr) {
  // AAAA-MM-DD HH:MM (formato canónico)
  let m = fechaStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m) { const [, yy, mm, dd, hh, min] = m; return new Date(Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(min)); }
  // dd/mm/aa hh:mm (tabla cruda de Ganamos)
  m = fechaStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (m) { const [, dd, mm, yy, hh, min] = m; const anio = yy.length === 2 ? 2000 + Number(yy) : Number(yy); return new Date(anio, Number(mm) - 1, Number(dd), Number(hh), Number(min)); }
  return null;
}
export function parseGanamosTabla(texto) {
  const filas = []; const errores = [];
  (texto || "").split("\n").forEach((linea, i) => {
    const limpia = linea.trim();
    if (!limpia) return;

    let tx, fechaStr, operacion, usuario, cantidadStr, saldoStr;
    if (limpia.includes("|")) {
      const celdas = limpia.split("|").map((c) => c.trim());
      // 5 campos (formato viejo, sin saldo) o 6 (con el saldo después de esa operación).
      if (celdas.length !== 5 && celdas.length !== 6) { errores.push({ linea: i + 1, texto: limpia, motivo: "se esperaban 5 o 6 campos separados por |" }); return; }
      [tx, fechaStr, operacion, usuario, cantidadStr, saldoStr] = celdas;
    } else {
      let celdas = limpia.split("\t").map((c) => c.trim());
      if (celdas.length < 7) celdas = limpia.split(/\s{2,}/).map((c) => c.trim());
      if (celdas.length < 7) { errores.push({ linea: i + 1, texto: limpia, motivo: "no se reconocen las columnas" }); return; }
      [tx, fechaStr, operacion, , , usuario, cantidadStr] = celdas;
      // Tabla cruda: la última columna trae "saldo antes → saldo después" en una sola celda.
      const ultima = celdas[celdas.length - 1];
      const numerosSaldo = ultima.match(/[\d.,]+/g);
      if (numerosSaldo && numerosSaldo.length >= 2) saldoStr = numerosSaldo[numerosSaldo.length - 1];
    }
    if (normalizarTexto(tx) === "transaccion" || normalizarTexto(tx) === "tx") return; // fila de encabezado

    const tipo = GANAMOS_OPERACION_A_TIPO[normalizarTexto(operacion)];
    if (!tipo) { errores.push({ linea: i + 1, texto: limpia, motivo: `operación desconocida: "${operacion}"` }); return; }

    const fecha = parsearFecha(fechaStr);
    if (!fecha || isNaN(fecha.getTime())) { errores.push({ linea: i + 1, texto: limpia, motivo: `fecha no reconocida: "${fechaStr}"` }); return; }

    // Ganamos muestra el Bonus como porcentaje (ej "15%"), no en pesos — se resuelve
    // más abajo, buscando el depósito del mismo usuario más cercano en el tiempo.
    const esPorcentaje = /%\s*$/.test(cantidadStr || "");
    const pctBono = esPorcentaje ? num(cantidadStr.replace("%", "")) / 100 : null;
    const monto = esPorcentaje ? null : num(cantidadStr);
    if (!esPorcentaje && !monto) { errores.push({ linea: i + 1, texto: limpia, motivo: `monto inválido: "${cantidadStr}"` }); return; }
    if (!usuario) { errores.push({ linea: i + 1, texto: limpia, motivo: "sin usuario" }); return; }

    const saldoDespues = saldoStr ? num(saldoStr) : null;

    filas.push({ tx, fecha, tipo, usuario, monto, saldoDespues: saldoDespues || null, pctBono, linea: i + 1, texto: limpia });
  });

  // Resolver los bonos que vinieron en % (no en pesos): buscar el depósito del mismo
  // usuario más cercano en el tiempo (±30 min) y calcular el monto real.
  const TOLERANCIA_BONO_MS = 30 * 60 * 1000;
  filas.forEach((f) => {
    if (f.tipo !== "bono" || f.pctBono == null) return;
    let mejor = null, mejorDif = Infinity;
    filas.forEach((o) => {
      if (o.tipo !== "carga" || o.usuario !== f.usuario) return;
      const dif = Math.abs(o.fecha.getTime() - f.fecha.getTime());
      if (dif < mejorDif) { mejor = o; mejorDif = dif; }
    });
    if (mejor && mejorDif <= TOLERANCIA_BONO_MS) {
      f.monto = Math.round(mejor.monto * f.pctBono);
    } else {
      errores.push({ linea: f.linea, texto: f.texto, motivo: `bono en % de "${f.usuario}" sin depósito cercano para calcular el monto en pesos` });
    }
  });

  return { filas: filas.filter((f) => f.monto != null), errores };
}

// Cruza lo que el empleado anotó en vivo (origen + monto, sin saber el usuario de Ganamos)
// contra las filas ya parseadas de Ganamos para ESE turno, para validar que el bono que dio
// la plataforma coincide con lo que corresponde según el origen.
//   - "nuevo" (P): regla estricta, tiene que haber ~50% de bono.
//   - "derivado" (R) y "lista" (L): todavía no hay un % único y fijo (depende de otros
//     factores que no vemos acá) — se muestra el % real encontrado, sin marcar error.
const ORIGEN_BONO_ESPERADO = { nuevo: 0.5 };
const TOLERANCIA_PORCENTUAL = 0.02; // 2 puntos porcentuales de margen
const TOLERANCIA_MINUTOS = 60;

export function cruzarRegistrosConGanamos(registros, filasGanamosDelTurno) {
  const cargas = filasGanamosDelTurno.filter((f) => f.tipo === "carga");
  const bonos = filasGanamosDelTurno.filter((f) => f.tipo === "bono");

  return registros.map((r) => {
    const montoR = num(r.monto);
    const horaR = new Date(r.hora);
    let mejor = null, mejorDif = Infinity;
    cargas.forEach((c) => {
      if (num(c.monto) !== montoR) return;
      const dif = Math.abs(c.fecha.getTime() - horaR.getTime());
      if (dif < mejorDif) { mejor = c; mejorDif = dif; }
    });
    if (!mejor || mejorDif > TOLERANCIA_MINUTOS * 60 * 1000) {
      return { ...r, estado: "sin_match", usuario: null, detalle: "No se encontró en Ganamos una carga de ese monto cerca de esa hora." };
    }

    const bonoReal = bonos.find((b) => b.usuario === mejor.usuario);
    const bonoRealMonto = bonoReal ? num(bonoReal.monto) : 0;
    const bonoRealPct = montoR ? bonoRealMonto / montoR : 0;
    const pctEsperado = ORIGEN_BONO_ESPERADO[r.origen];

    if (pctEsperado == null) {
      return {
        ...r, estado: "ok", usuario: mejor.usuario, bonoRealPct,
        detalle: bonoReal ? `Bono encontrado: ${Math.round(bonoRealPct * 100)}%` : "Sin bono registrado en Ganamos",
      };
    }
    if (!bonoReal || Math.abs(bonoRealPct - pctEsperado) > TOLERANCIA_PORCENTUAL) {
      return {
        ...r, estado: "revisar", usuario: mejor.usuario, bonoRealPct,
        detalle: bonoReal ? `Bono real ${Math.round(bonoRealPct * 100)}%, se esperaba ${Math.round(pctEsperado * 100)}%` : `Falta el bono del ${Math.round(pctEsperado * 100)}%`,
      };
    }
    return { ...r, estado: "ok", usuario: mejor.usuario, bonoRealPct, detalle: `Bono correcto (${Math.round(bonoRealPct * 100)}%)` };
  });
}
