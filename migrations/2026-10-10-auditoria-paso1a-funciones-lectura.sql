-- ============================================================
-- Auditoría de seguridad — Paso 1A: funciones para leer shifts/databases
-- sin exponerlas por lectura pública.
-- Correr en Supabase → SQL Editor → Run.
--
-- Esto SOLO agrega funciones nuevas — no borra ni cambia ninguna política
-- todavía, así que no corta el acceso de nadie. El cierre real de la
-- lectura pública es un script aparte (Paso 1B) que se corre recién
-- después de confirmar que el panel de Admin sigue andando bien con
-- este cambio ya desplegado.
--
-- Reemplazan estas 4 lecturas directas que hoy hace AdminDashboard.jsx:
--   .from("shifts").select("*").eq("status","cerrado").eq("archivado",false)...
--   .from("shifts").select("*").eq("status","abierto").eq("archivado",false)...
--   .from("shifts").select("*").eq("archivado", true)...limit(200)
--   .from("databases").select("*").order("created_at",...)
-- ============================================================

create or replace function admin_list_shifts_cerrados(input_admin_pin text)
returns setof shifts
language sql
security definer
set search_path to 'public'
as $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and status = 'cerrado' and archivado = false
  order by cerrado_at desc nulls last;
$function$;

create or replace function admin_list_shifts_abiertos(input_admin_pin text)
returns setof shifts
language sql
security definer
set search_path to 'public'
as $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and status = 'abierto' and archivado = false
  order by updated_at desc;
$function$;

create or replace function admin_list_shifts_archivados(input_admin_pin text)
returns setof shifts
language sql
security definer
set search_path to 'public'
as $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and archivado = true
  order by updated_at desc
  limit 200;
$function$;

create or replace function admin_list_databases(input_admin_pin text)
returns setof databases
language sql
security definer
set search_path to 'public'
as $function$
  select * from databases
  where verify_admin_pin(input_admin_pin) = true
  order by created_at desc;
$function$;
