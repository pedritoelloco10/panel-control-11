-- ============================================================
-- Segundo contador: cuántos cargaron a partir de los mensajes de
-- publicidad, además del contador de mensajes que ya existía.
-- Correr en Supabase → SQL Editor → Run.
--
-- Reusa la tabla publicidad_eventos (no hace falta una tabla nueva):
-- se le agrega una columna "tipo" ('mensaje' | 'carga') para distinguir
-- los dos contadores. Las funciones existentes se extienden con un
-- parámetro p_tipo opcional (default 'mensaje', para no romper nada que
-- ya las esté llamando sin ese parámetro).
-- ============================================================

alter table publicidad_eventos add column if not exists tipo text not null default 'mensaje';
alter table publicidad_eventos drop constraint if exists publicidad_eventos_tipo_check;
alter table publicidad_eventos add constraint publicidad_eventos_tipo_check check (tipo in ('mensaje', 'carga'));

create or replace function session_count_publicidad_hoy(input_token uuid, p_tipo text default 'mensaje')
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

create or replace function session_add_publicidad_evento(input_token uuid, p_tipo text default 'mensaje')
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

create or replace function session_remove_publicidad_evento(input_token uuid, p_tipo text default 'mensaje')
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

create or replace function admin_count_publicidad(input_admin_pin text, fecha_desde date default null, fecha_hasta date default null, p_tipo text default 'mensaje')
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

create or replace function admin_publicidad_por_turno(input_admin_pin text)
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
