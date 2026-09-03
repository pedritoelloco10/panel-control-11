-- ============================================================
-- CRM de Bases — Parte 2: reparto y reciclado (session_get_leads)
-- Correr en Supabase → SQL Editor → Run.
--
-- Requiere que la Parte 1 (columnas y tablas nuevas) ya esté corrida.
--
-- Qué cambia respecto a la versión actual (la que ya tiene "base
-- prioritaria"):
--   1. Los 3 tramos de reparto (relleno-masiva, resto-principales/comprada,
--      sobrante) ahora exigen `d.activa = true` y `c2.pausado = false`, y
--      aceptan `para_retomar` como estado candidato además de nuevo/contactado.
--   2. El reciclado (antes solo le sacaba asignado_a) ahora:
--      - Si `veces_reciclado + 1 < max_reciclados` → pasa a `para_retomar`,
--        suma 1 a `veces_reciclado`.
--      - Si no → pasa directo a `descartado` con el motivo que pediste.
--      - Cualquiera de los dos casos queda registrado en `contact_events`
--        (accion `reciclado_automatico` o `descartado_automatico`), para que
--        el timeline completo (Parte 6) los muestre.
--   3. `ultimo_evento_resumen` NO se toca acá — se deja el último evento
--      humano tal cual estaba, que es justo lo útil para quien retoma el
--      contacto. Eso se actualiza desde las funciones que sí representan
--      una acción de una persona (Parte 3).
--
-- Todo lo demás de la función (ventana horaria, candados anti-carrera con
-- for update skip locked, cupo diario/refuerzo) queda exactamente igual.
--
-- Riesgo: como con "base prioritaria", esto reemplaza la función que corre
-- en vivo cada vez que alguien entra a Bases — el cambio es inmediato para
-- todo el equipo. Ningún contacto existente tiene `pausado=true` ni ninguna
-- base tiene `activa=false` todavía (los defaults de la Parte 1 son
-- true/false respectivamente, o sea "todo sigue igual"), así que el reparto
-- de hoy no debería cambiar en nada hasta que se pause algo a propósito.
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
  dias_recicla int; horas_recicla int; max_recic int;
  local_time time := (now() at time zone 'America/Argentina/Buenos_Aires')::time;
  en_horario_general boolean := local_time >= time '10:00' and local_time < time '22:00';
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  select coalesce((select value::int from app_config where key = 'dias_reciclar_contactado'), 3) into dias_recicla;
  select coalesce((select value::int from app_config where key = 'horas_reciclar_contestado'), 24) into horas_recicla;
  select coalesce((select value::int from app_config where key = 'max_reciclados'), 3) into max_recic; -- NUEVO

  -- Reciclado de "contactado" sin avance — NUEVO: para_retomar / descartado
  -- según veces_reciclado, en vez de solo soltar asignado_a.
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
        and fecha_asignacion < current_date - dias_recicla
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

  -- Reciclado de "contestado"/"interesado" sin avance — mismo tratamiento.
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

  if emp.recibe_leads is not true or not en_horario_general then
    return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
    return;
  end if;

  select is_refuerzo_now(emp.nombre) into es_refuerzo;
  if es_refuerzo then
    select coalesce((select value::int from app_config where key = 'cupo_refuerzo_leads'), 20) into cupo;
  else
    select coalesce((select value::int from app_config where key = 'cupo_diario_leads'), 35) into cupo;
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
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente = 'masiva' -- NUEVO: para_retomar
          and d.activa = true and c2.pausado = false -- NUEVO
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random()
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
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente in ('principales', 'comprada') -- NUEVO
          and d.activa = true and c2.pausado = false -- NUEVO
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random()
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
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') -- NUEVO
          and d.activa = true and c2.pausado = false -- NUEVO
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random()
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
