-- ============================================================
-- "Base prioritaria" en el reparto de leads
-- Correr en Supabase → tu proyecto → SQL Editor → Run.
--
-- Qué hace: permite marcar una base como prioritaria desde Admin. Mientras
-- esté marcada, sus leads se reparten ANTES que los de las demás bases de
-- la misma franja de calidad (sigue respetando el mismo ~15% de "Masiva"
-- vs el resto, sigue reciclando conversaciones calientes, sigue con el
-- mismo candado anti-carrera que ya tenía) — hasta que esa base se quede
-- sin leads "nuevo"/"contactado" disponibles, y ahí el reparto sigue solo
-- con las demás. Así se puede concentrar al equipo en una base hasta
-- agotarla y después pasar a la siguiente, sin abandonar leads que ya
-- contestaron ni perder la protección de calidad que ya tenía el sistema.
--
-- Riesgo de correr esto: BAJO. Es un solo `alter table` (agrega una columna
-- con default `false`) más un `create or replace function` que reemplaza
-- session_get_leads — la función que usa la app cada vez que alguien entra
-- a Bases, así que el cambio es inmediato para todo el equipo en cuanto lo
-- corras. Pero como ninguna base arranca marcada como prioritaria
-- (`default false`), y `order by false desc, random()` es lo mismo que
-- `order by random()` de antes, EL COMPORTAMIENTO DE HOY NO CAMBIA hasta
-- que vos marques una base como prioritaria desde el panel — recién ahí
-- empieza a tener efecto.
-- ============================================================

alter table databases add column if not exists prioridad boolean not null default false;

create or replace function admin_toggle_base_prioridad(input_admin_pin text, target_id uuid, nueva_prioridad boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update databases set prioridad = nueva_prioridad where id = target_id;
  return true;
end;
$function$;

-- Reemplazo de session_get_leads: idéntica a la que ya tenías, con dos
-- diferencias marcadas con "-- NUEVO" más abajo (el order by de las 3
-- franjas ahora prioriza `d.prioridad`, y la franja "sobrante" ahora hace
-- join con databases para poder leerla — antes no lo necesitaba).
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
  dias_recicla int; horas_recicla int;
  local_time time := (now() at time zone 'America/Argentina/Buenos_Aires')::time;
  en_horario_general boolean := local_time >= time '10:00' and local_time < time '22:00';
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  select coalesce((select value::int from app_config where key = 'dias_reciclar_contactado'), 3) into dias_recicla;
  select coalesce((select value::int from app_config where key = 'horas_reciclar_contestado'), 24) into horas_recicla;

  update contacts set asignado_a = null
  where estado = 'contactado' and asignado_a is not null
    and fecha_asignacion < current_date - dias_recicla;

  update contacts set asignado_a = null
  where estado in ('contestado', 'interesado') and asignado_a is not null
    and estado_actualizado_at < now() - (horas_recicla || ' hours')::interval;

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
        where c2.estado in ('nuevo', 'contactado') and d.tipo_fuente = 'masiva'
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random() -- NUEVO: la base prioritaria sale primero dentro de esta franja
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
        where c2.estado in ('nuevo', 'contactado') and d.tipo_fuente in ('principales', 'comprada')
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random() -- NUEVO
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
        join databases d on d.id = c2.base_id -- NUEVO: antes esta franja no necesitaba el join
        where c2.estado in ('nuevo', 'contactado')
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, random() -- NUEVO
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
