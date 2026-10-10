-- ============================================================
-- Auditoría de seguridad — Paso 4B: borrar employees.pin (texto plano).
-- Correr en Supabase → SQL Editor → Run.
--
-- Ya confirmado que todo el login (empleados, crear/editar en Admin)
-- funciona con pin_hash. Esta columna ya no la lee ni la escribe ninguna
-- función — es la última pieza en texto plano que quedaba.
-- ============================================================

alter table employees drop column pin;
