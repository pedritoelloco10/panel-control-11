export const PLATFORMS = [
  { key: "B", label: "BET" },
  { key: "G", label: "GANA" },
];
export const DB_TYPES = { general: "General", reactivacion: "Reactivación 7+ días", comprada: "Base comprada" };
export const ADMIN_PIN = "2580";
export const SEED_ROWS = 15;
export const GROW_BATCH = 8;

export function num(v) {
  const n = parseFloat(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
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
export function blankOp() {
  return { id: uid(), plataforma: "B", tipo: "carga", monto: "", bono: "", origen: null };
}
export function seedOps(n) {
  return Array.from({ length: n }, blankOp);
}
