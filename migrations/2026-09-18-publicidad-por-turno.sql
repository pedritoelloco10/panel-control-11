-- ============================================================
-- Corrección: contador de mensajes de publicidad, ahora por turno
-- Correr en Supabase → SQL Editor → Run.
--
-- Hasta ahora publicidad_eventos no sabía a qué turno pertenecía cada
-- mensaje: session_count_publicidad_hoy contaba TODOS los empleados
-- juntos por fecha (ni siquiera filtraba por empleado), y
-- admin_publicidad_por_turno aproximaba por ventana de horario. Esto
-- ata cada evento al shift_id real del turno abierto en el momento de
-- cargarlo, así cada turno arranca su propia cuenta en 0.
--
-- Eventos viejos (de antes de esta migración) quedan con shift_id null
-- — no se les puede atribuir un turno puntual con certeza, así que no
-- cuentan en ningún turno específico, pero siguen contando en el total
-- por rango de fechas de admin_count_publicidad (que no cambia).
-- ============================================================

alter table publicidad_eventos add column if not exists shift_id uuid references shifts(id);
create index if not exists publicidad_eventos_shift_idx on publicidad_eventos (shift_id);

-- ---------- Empleado: sumar un mensaje al turno actualmente abierto ----------
create or replace function session_add_publicidad_evento(input_token uuid)
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

  insert into publicidad_eventos (empleado, shift_id) values (emp.nombre, v_shift_id);
  return true;
end;
$function$;

-- ---------- Empleado: restar el mensaje más reciente de ESTE empleado en ESTE turno ----------
create or replace function session_remove_publicidad_evento(input_token uuid)
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
  where empleado = emp.nombre and shift_id = v_shift_id
  order by created_at desc
  limit 1;
  if v_id is null then return false; end if;

  delete from publicidad_eventos where id = v_id;
  return true;
end;
$function$;

-- ---------- Empleado: cuántos van en ESTE turno (para mostrar al lado del botón) ----------
create or replace function session_count_publicidad_hoy(input_token uuid)
returns int
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

  select count(*) into v_count from publicidad_eventos where shift_id = v_shift_id;
  return v_count;
end;
$function$;

-- ---------- Admin: cantidad por turno puntual (Admin > Turnos) ----------
-- Reemplaza la versión anterior basada en ventana de horario — ahora que
-- cada evento guarda su shift_id, es un conteo directo y exacto.
create or replace function admin_publicidad_por_turno(input_admin_pin text)
returns table(shift_id uuid, cantidad int)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select s.id as shift_id, count(pe.id)::int as cantidad
  from shifts s
  left join publicidad_eventos pe on pe.shift_id = s.id
  group by s.id;
end;
$function$;
