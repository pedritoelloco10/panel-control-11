-- ============================================================
-- Auditoría de seguridad — Paso 4A (HOTFIX 2): employees.pin (la columna
-- vieja en texto plano) todavía tenía NOT NULL, así que crear un
-- empleado nuevo fallaba (admin_add_employee ya no la llena).
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================

alter table employees alter column pin drop not null;
