-- ============================================================
-- Salvaguarda final: nunca quedar por encima del cupo
-- Correr en Supabase → SQL Editor → Run.
--
-- El lock de la migración anterior (pg_advisory_xact_lock) debería
-- evitar la carrera de dos llamadas simultáneas, pero volvió a pasar hoy
-- (un empleado con 133 en vez de 75) — no importa identificar la causa
-- exacta con certeza total, importa que nunca vuelva a pasar. Se agrega
-- un chequeo final, DESPUÉS de repartir: si el empleado terminó con más
-- activos que su cupo (por cualquier motivo), se le saca el excedente —
-- solo de los que quedaron en "nuevo" en esta misma llamada, nunca algo
-- que ya esté en curso (contactado/contestado/interesado), para no
-- cortar ningún seguimiento real. Esto es una garantía dura, no depende
-- de que el lock funcione perfecto en todos los casos.
--
-- Único cambio real respecto a la versión anterior: el bloque nuevo al
-- final, justo antes del `return query` final. Todo lo demás queda
-- exactamente igual (incluido el lock, que se deja — reduce cuánto
-- trabajo de más se hace, aunque ya no sea la única protección).
-- ============================================================

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

  perform pg_advisory_xact_lock(hashtext(emp.nombre));

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

  -- NUEVO: salvaguarda dura — si por cualquier motivo terminó por encima
  -- del cupo, sacarle el excedente (solo "nuevo", nunca algo en curso).
  select count(*) into activos from contacts
  where asignado_a = emp.nombre and fecha_asignacion = current_date
    and estado in ('nuevo', 'contactado', 'contestado', 'interesado');

  if activos > cupo then
    update contacts c set asignado_a = null, fecha_asignacion = null
    from (
      select id from contacts
      where asignado_a = emp.nombre and fecha_asignacion = current_date and estado = 'nuevo'
      order by id
      limit (activos - cupo)
    ) sub
    where c.id = sub.id;
  end if;

  return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
end;
$function$;
