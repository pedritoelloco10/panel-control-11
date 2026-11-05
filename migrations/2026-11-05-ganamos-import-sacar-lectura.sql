-- ============================================================
-- Revertir: el código limitado de Ganamos no debe poder LEER nada, ni
-- siquiera la lista de turnos (a pedido explícito) — solo cargar.
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================

drop function if exists ganamos_import_list_shifts_cerrados(text);
