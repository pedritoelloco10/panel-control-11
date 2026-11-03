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
  return new Date().toISOString().slice(0, 10);
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

// Convierte la tabla de "Depósitos/Retiros Jugadores" de Ganamos, tal cual se
// pega copiándola del navegador, en filas estructuradas. El navegador copia
// una tabla HTML como una línea por fila y las celdas separadas por tabs —
// por eso se parte primero por tab, y si una línea no trae tabs (se pegó con
// espacios en vez de tabs) se usa 2+ espacios seguidos como separador.
// Columnas esperadas: TRANSACCIÓN | FECHA | OPERACIÓN | INICIADOR | DE | A | CANTIDAD | SALDO
const GANAMOS_OPERACION_A_TIPO = { deposito: "carga", retiro: "retiro", bonus: "bono" };
function normalizarTexto(s) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function parseGanamosTabla(texto) {
  const filas = []; const errores = [];
  (texto || "").split("\n").forEach((linea, i) => {
    const limpia = linea.trim();
    if (!limpia) return;
    let celdas = limpia.split("\t").map((c) => c.trim());
    if (celdas.length < 7) celdas = limpia.split(/\s{2,}/).map((c) => c.trim());
    if (celdas.length < 7) { errores.push({ linea: i + 1, texto: limpia, motivo: "no se reconocen las columnas" }); return; }
    const [tx, fechaStr, operacion, , , usuario, cantidadStr] = celdas;
    if (normalizarTexto(tx) === "transaccion") return; // fila de encabezado

    const tipo = GANAMOS_OPERACION_A_TIPO[normalizarTexto(operacion)];
    if (!tipo) { errores.push({ linea: i + 1, texto: limpia, motivo: `operación desconocida: "${operacion}"` }); return; }

    const m = fechaStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
    if (!m) { errores.push({ linea: i + 1, texto: limpia, motivo: `fecha no reconocida: "${fechaStr}"` }); return; }
    const [, dd, mm, yy, hh, min] = m;
    const anio = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const fecha = new Date(anio, Number(mm) - 1, Number(dd), Number(hh), Number(min));
    if (isNaN(fecha.getTime())) { errores.push({ linea: i + 1, texto: limpia, motivo: `fecha inválida: "${fechaStr}"` }); return; }

    const monto = num(cantidadStr);
    if (!monto) { errores.push({ linea: i + 1, texto: limpia, motivo: `monto inválido: "${cantidadStr}"` }); return; }
    if (!usuario) { errores.push({ linea: i + 1, texto: limpia, motivo: "sin usuario" }); return; }

    filas.push({ tx, fecha, tipo, usuario, monto });
  });
  return { filas, errores };
}
