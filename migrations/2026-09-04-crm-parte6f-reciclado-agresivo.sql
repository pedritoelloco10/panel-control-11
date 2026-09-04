-- ============================================================
-- CRM de Bases — Parte 6f: reparto más agresivo (nuevo primero,
-- reciclado de "Contactado" cada 18hs en vez de 3 días, tope de
-- reintentos subido a 6)
-- Correr en Supabase → SQL Editor → Run.
--
-- Tres cambios pedidos:
--
-- 1. El reparto ahora agota los contactos "Nuevo" disponibles antes de
--    ofrecer los ya "Contactado" (antes se mezclaban al azar, sin ningún
--    orden entre estados). Se agrega `(c2.estado = 'nuevo') desc` como
--    segundo criterio de orden en los 3 tramos de reparto (relleno,
--    resto, sobrante) — dentro de cada nivel de prioridad de base, los
--    Nuevos salen siempre primero.
--
-- 2. El reciclado de "Contactado" sin avance pasaba por día calendario
--    completo (`fecha_asignacion < hoy - N días`) — no podía expresar
--    "18 horas", solo días enteros. Se cambia para que use la misma
--    lógica que ya usa "Contestado"/"Interesado": horas reales desde
--    `estado_actualizado_at`. Nueva clave de configuración
--    `horas_reciclar_contactado` (default 18) reemplaza a
--    `dias_reciclar_contactado` (que queda sin uso, se puede borrar de
--    app_config si se quiere, no hace falta).
--
-- 3. `max_reciclados` sube de 3 a 6 — con el ciclo más corto (18hs en
--    vez de 3 días), había que subir el tope de reintentos para no
--    descartar contactos mucho antes de lo que se busca (de ~9 días de
--    insistencia a ~4,5 días si se hubiera dejado en 3).
-- ============================================================

update app_config set value = '6' where key = 'max_reciclados';
insert into app_config (key, value) values ('horas_reciclar_contactado', '18')
  on conflict (key) do update set value = excluded.value;

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

  -- Reciclado de "contactado" sin avance — NUEVO: por horas reales, no por día calendario.
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

  -- Reciclado de "contestado"/"interesado" sin avance — mismo tratamiento, sin cambios.
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
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente = 'masiva'
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random() -- NUEVO: nuevo siempre primero
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
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random() -- NUEVO: nuevo siempre primero
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
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random() -- NUEVO: nuevo siempre primero
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
