-- ============================================================
-- Auditoría de seguridad — Paso 1B: cerrar la lectura pública de
-- shifts y databases.
-- Correr en Supabase → SQL Editor → Run.
--
-- Esto SÍ es destructivo: a partir de acá, leer shifts o databases desde
-- afuera de las funciones admin_list_shifts_*/admin_list_databases/
-- session_mi_turno_abierto/session_turno_abierto_actual/
-- session_ultimo_cierre_arrastre deja de funcionar.
--
-- Recién correr esto después de confirmar (ya confirmado):
--   - Admin > Turnos/Análisis/Bases cargan bien con las funciones nuevas.
--   - Abrir/retomar un turno (refresh de página) sigue andando igual.
--
-- `databases` tenía DOS políticas de lectura pública redundantes
-- ("lectura publica" y "databases select", mismo efecto) — se borran las dos.
-- `wallets` y `clientes` NO se tocan: quedan como estaban a propósito
-- (wallets se necesita antes de loguearse, clientes no tiene datos sensibles).
-- ============================================================

drop policy "shifts select" on shifts;
drop policy "databases select" on databases;
drop policy "lectura publica" on databases;
