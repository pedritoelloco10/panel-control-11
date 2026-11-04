-- ============================================================
-- Reiniciar el contador del ranking de clientes sin borrar historial.
-- Correr en Supabase → SQL Editor → Run.
--
-- Agrega la clave de configuración que usa el botón "Reiniciar contador
-- desde hoy" en la pestaña Clientes del panel admin. Por defecto queda
-- vacía (el ranking sigue mostrando todo el historial hasta que se use
-- el botón por primera vez).
-- ============================================================

insert into app_config (key, value) values ('clientes_desde', '')
  on conflict (key) do nothing;
