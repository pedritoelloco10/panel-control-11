-- ============================================================
-- Contador de mensajes de publicidad
-- Correr en Supabase → SQL Editor → Run.
--
-- Tabla nueva, sin relación con nada de Bases — log de eventos (no un
-- contador acumulado) para poder filtrar por fecha igual que el resto de
-- los reportes de Admin. El campo `campana` ya queda listo para el día
-- que haya más de una campaña activa a la vez, sin tener que tocar el
-- esquema de nuevo.
--
-- Cerrada a acceso directo (RLS sin políticas) — mismo patrón que
-- `contacts`/`shifts`: todo pasa por funciones SECURITY DEFINER con
-- token de sesión (empleados) o PIN de admin.
-- ============================================================

create table if not exists publicidad_eventos (
  id uuid primary key default gen_random_uuid(),
  empleado text not null,
  campana text not null default 'general',
  created_at timestamptz not null default now()
);
create index if not exists publicidad_eventos_created_idx on publicidad_eventos (created_at);
alter table publicidad_eventos enable row level security;

-- ---------- Empleado: sumar un mensaje ----------
create or replace function session_add_publicidad_evento(input_token uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  insert into publicidad_eventos (empleado) values (emp.nombre);
  return true;
end;
$function$;

-- ---------- Empleado: cuántos van hoy (para mostrar al lado del botón) ----------
create or replace function session_count_publicidad_hoy(input_token uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_count int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return 0; end if;

  select count(*) into v_count from publicidad_eventos
  where (created_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  return v_count;
end;
$function$;

-- ---------- Admin: total en un rango de fechas (para Análisis) ----------
create or replace function admin_count_publicidad(input_admin_pin text, fecha_desde date default null, fecha_hasta date default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if verify_admin_pin(input_admin_pin) is not true then return 0; end if;

  select count(*) into v_count from publicidad_eventos
  where (fecha_desde is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date >= fecha_desde)
    and (fecha_hasta is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date <= fecha_hasta);

  return v_count;
end;
$function$;
