-- ============================================================
-- Reconstrucción completa y de una sola vez de las funciones de
-- publicidad (mensajes / cargas). Los dos intentos anteriores de hoy
-- (2026-11-05-publicidad-contador-cargas.sql y
-- 2026-11-05-publicidad-fix-duplicados-tipo.sql) dejaron la base en un
-- estado a medio camino — probablemente porque la migración original
-- falló a mitad de camino (el error de "cannot change return type" en
-- admin_publicidad_por_turno aborta TODO lo que vino antes en la misma
-- corrida, no solo esa función) y lo que siguió después no terminó de
-- dejar las 5 funciones consistentes entre sí.
--
-- Esta migración no asume nada del estado actual: borra TODAS las
-- firmas posibles (viejas y nuevas, con IF EXISTS así no falla si
-- alguna ya no está) y las vuelve a crear de cero, todas juntas, en una
-- sola corrida. Correr en Supabase → SQL Editor → Run, una sola vez.
-- ============================================================

alter table publicidad_eventos add column if not exists tipo text not null default 'mensaje';
alter table publicidad_eventos drop constraint if exists publicidad_eventos_tipo_check;
alter table publicidad_eventos add constraint publicidad_eventos_tipo_check check (tipo in ('mensaje', 'carga'));

drop function if exists session_count_publicidad_hoy(uuid);
drop function if exists session_count_publicidad_hoy(uuid, text);
drop function if exists session_add_publicidad_evento(uuid);
drop function if exists session_add_publicidad_evento(uuid, text);
drop function if exists session_remove_publicidad_evento(uuid);
drop function if exists session_remove_publicidad_evento(uuid, text);
drop function if exists admin_count_publicidad(text, date, date);
drop function if exists admin_count_publicidad(text, date, date, text);
drop function if exists admin_publicidad_por_turno(text);

create function session_count_publicidad_hoy(input_token uuid, p_tipo text default 'mensaje')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_shift_id uuid; v_count int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return 0; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return 0; end if;

  select count(*) into v_count from publicidad_eventos where shift_id = v_shift_id and tipo = p_tipo;
  return v_count;
end;
$function$;

create function session_add_publicidad_evento(input_token uuid, p_tipo text default 'mensaje')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_shift_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return false; end if;

  insert into publicidad_eventos (empleado, shift_id, tipo) values (emp.nombre, v_shift_id, p_tipo);
  return true;
end;
$function$;

create function session_remove_publicidad_evento(input_token uuid, p_tipo text default 'mensaje')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_shift_id uuid; v_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return false; end if;

  select id into v_id from publicidad_eventos
  where empleado = emp.nombre and shift_id = v_shift_id and tipo = p_tipo
  order by created_at desc
  limit 1;
  if v_id is null then return false; end if;

  delete from publicidad_eventos where id = v_id;
  return true;
end;
$function$;

create function admin_count_publicidad(input_admin_pin text, fecha_desde date default null, fecha_hasta date default null, p_tipo text default 'mensaje')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if verify_admin_pin(input_admin_pin) is not true then return 0; end if;

  select count(*) into v_count from publicidad_eventos
  where tipo = p_tipo
    and (fecha_desde is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date >= fecha_desde)
    and (fecha_hasta is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date <= fecha_hasta);

  return v_count;
end;
$function$;

create function admin_publicidad_por_turno(input_admin_pin text)
returns table(shift_id uuid, mensajes integer, cargas integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select s.id as shift_id,
    count(pe.id) filter (where pe.tipo = 'mensaje')::int as mensajes,
    count(pe.id) filter (where pe.tipo = 'carga')::int as cargas
  from shifts s
  left join publicidad_eventos pe on pe.shift_id = s.id
  group by s.id;
end;
$function$;

-- Chequeo: cada una de estas 5 consultas tiene que devolver UNA sola fila,
-- y pronargs tiene que ser 2 (las 3 de session_*), 4 (admin_count_publicidad)
-- y 1 (admin_publicidad_por_turno).
-- select proname, pronargs from pg_proc where proname = 'session_add_publicidad_evento';
-- select proname, pronargs from pg_proc where proname = 'session_remove_publicidad_evento';
-- select proname, pronargs from pg_proc where proname = 'session_count_publicidad_hoy';
-- select proname, pronargs from pg_proc where proname = 'admin_count_publicidad';
-- select proname, pronargs from pg_proc where proname = 'admin_publicidad_por_turno';
