-- ============================================================
-- Cupo de leads personalizado por empleado
-- Correr en Supabase → SQL Editor → Run.
--
-- Hoy el cupo diario cuando alguien es principal (no refuerzo) es un solo
-- número global (app_config.cupo_diario_leads). Se agrega la posibilidad
-- de cargarle un cupo distinto a un empleado puntual — si no se carga
-- (null), sigue usando el global de siempre. El cupo de refuerzo NO
-- cambia, sigue siendo un valor único global para cualquiera.
--
-- session_employee no hacía `select *` — seleccionaba columnas puntuales
-- (id, nombre, recibe_leads), así que hay que sumarle `cupo_leads` ahí
-- también para que session_get_leads lo pueda leer. Como cambia el
-- RETURNS TABLE, hace falta un DROP antes del CREATE (Postgres no deja
-- cambiar el tipo de retorno con CREATE OR REPLACE). session_employee lo
-- llaman muchas otras funciones (session_get_leads, session_set_estado,
-- etc.) — el DROP no las rompe: son cuerpos de función independientes,
-- no hay una dependencia dura que bloquee el DROP, y todas usan
-- `select * into emp from session_employee(...)` con una variable RECORD,
-- así que una columna nueva de más no les afecta.
-- ============================================================

alter table employees add column if not exists cupo_leads int;

drop function if exists session_employee(uuid);
create or replace function session_employee(input_token uuid)
returns table(id uuid, nombre text, recibe_leads boolean, cupo_leads int)
language sql
security definer
set search_path to 'public'
as $function$
  select e.id, e.nombre, e.recibe_leads, e.cupo_leads from sessions s
  join employees e on e.id = s.empleado_id
  where s.token = input_token and s.expires_at > now() and e.activo = true;
$function$;

-- ---------- session_get_leads: usar el cupo personal si está cargado ----------
create or replace function session_get_leads(input_token uuid)
returns setof contacts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  emp record; cupo int; activos int; faltan int; es_refuerzo boolean;
  pct_relleno numeric; relleno_objetivo int; tomados_relleno int := 0;
  resto int; tomados_resto int := 0; sobrante int;
  horas_recicla_contactado int; horas_recicla int; max_recic int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  select coalesce((select value::int from app_config where key = 'horas_reciclar_contactado'), 18) into horas_recicla_contactado;
  select coalesce((select value::int from app_config where key = 'horas_reciclar_contestado'), 24) into horas_recicla;
  select coalesce((select value::int from app_config where key = 'max_reciclados'), 6) into max_recic;

  with actualizados as (
    update contacts c set
      asignado_a = null,
      veces_reciclado = c.veces_reciclado + 1,
      estado = case when c.veces_reciclado + 1 < max_recic then 'para_retomar' else 'descartado' end,
      motivo_descarte = case when c.veces_reciclado + 1 >= max_recic then 'Sin respuesta tras varios intentos' else c.motivo_descarte end,
      estado_actualizado_at = now()
    from (
      select id from contacts
      where estado = 'contactado' and asignado_a is not null
        and estado_actualizado_at < now() - (horas_recicla_contactado || ' hours')::interval
      for update skip locked
    ) sub
    where c.id = sub.id
    returning c.id, c.base_id, c.veces_reciclado, c.estado
  )
  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  select base_id, id, 'sistema',
    case when estado = 'descartado' then 'descartado_automatico' else 'reciclado_automatico' end,
    jsonb_build_object('veces_reciclado', veces_reciclado)
  from actualizados;

  with actualizados as (
    update contacts c set
      asignado_a = null,
      veces_reciclado = c.veces_reciclado + 1,
      estado = case when c.veces_reciclado + 1 < max_recic then 'para_retomar' else 'descartado' end,
      motivo_descarte = case when c.veces_reciclado + 1 >= max_recic then 'Sin respuesta tras varios intentos' else c.motivo_descarte end,
      estado_actualizado_at = now()
    from (
      select id from contacts
      where estado in ('contestado', 'interesado') and asignado_a is not null
        and estado_actualizado_at < now() - (horas_recicla || ' hours')::interval
      for update skip locked
    ) sub
    where c.id = sub.id
    returning c.id, c.base_id, c.veces_reciclado, c.estado
  )
  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  select base_id, id, 'sistema',
    case when estado = 'descartado' then 'descartado_automatico' else 'reciclado_automatico' end,
    jsonb_build_object('veces_reciclado', veces_reciclado)
  from actualizados;

  if emp.recibe_leads is not true then
    return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
    return;
  end if;

  select is_refuerzo_now(emp.nombre) into es_refuerzo;
  if es_refuerzo then
    select coalesce((select value::int from app_config where key = 'cupo_refuerzo_leads'), 20) into cupo;
  else
    -- NUEVO: cupo personal del empleado si está cargado, si no, el global de siempre.
    select coalesce(emp.cupo_leads, (select value::int from app_config where key = 'cupo_diario_leads'), 35) into cupo;
  end if;

  select count(*) into activos from contacts
  where asignado_a = emp.nombre and fecha_asignacion = current_date
    and estado in ('nuevo', 'contactado', 'contestado', 'interesado');
  faltan := cupo - activos;

  if faltan > 0 then
    select coalesce((select value::numeric from app_config where key = 'porcentaje_relleno'), 15) into pct_relleno;
    relleno_objetivo := ceil(faltan * pct_relleno / 100.0);

    if relleno_objetivo > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente = 'masiva'
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit relleno_objetivo
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
      get diagnostics tomados_relleno = row_count;
    end if;

    resto := faltan - tomados_relleno;
    if resto > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente in ('principales', 'comprada')
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit resto
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
      get diagnostics tomados_resto = row_count;
    end if;

    sobrante := faltan - tomados_relleno - tomados_resto;
    if sobrante > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar')
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit sobrante
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
    end if;
  end if;

  return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
end;
$function$;

-- ---------- Admin: agregar/editar empleado, ahora con cupo_leads ----------
create or replace function admin_add_employee(input_admin_pin text, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  insert into employees (nombre, pin, recibe_leads, cupo_leads) values (new_nombre, new_pin, new_recibe_leads, new_cupo_leads);
  return true;
end;
$function$;

create or replace function admin_update_employee(input_admin_pin text, target_id uuid, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  update employees set nombre = new_nombre, pin = new_pin, recibe_leads = new_recibe_leads, cupo_leads = new_cupo_leads where id = target_id;
  return true;
end;
$function$;

-- ---------- Admin: listar empleados, ahora con cupo_leads (mismo caso que session_employee) ----------
drop function if exists admin_list_employees(text);
create or replace function admin_list_employees(input_admin_pin text)
returns table(id uuid, nombre text, pin text, activo boolean, recibe_leads boolean, cupo_leads int)
language sql
security definer
set search_path to 'public'
as $function$
  select e.id, e.nombre, e.pin, e.activo, e.recibe_leads, e.cupo_leads from employees e
  where verify_admin_pin(input_admin_pin) = true
  order by e.created_at;
$function$;
