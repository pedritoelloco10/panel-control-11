export const PLATFORMS = [
  { key: "B", label: "BET" },
  { key: "G", label: "GANA" },
];
export const DB_TYPES = { general: "General", reactivacion: "Reactivación 7+ días", comprada: "Base comprada" };
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
export const SEED_ROWS = 15;
export const GROW_BATCH = 8;

export function num(v) {
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
export function formatMiles(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export function money(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n || 0)).toLocaleString("es-AR");
}
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
