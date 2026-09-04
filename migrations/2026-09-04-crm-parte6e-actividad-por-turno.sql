-- ============================================================
-- CRM de Bases — Parte 6e: actividad de Bases por turno específico
-- Correr en Supabase → SQL Editor → Run.
--
-- La Parte 6c ya da un conteo confiable de mensajes por empleado/día
-- (admin_activity_por_empleado_fecha), sacado de contact_events. Pero
-- si el mismo empleado abre más de un turno el mismo día (ej. mañana y
-- de nuevo a la noche), ese conteo los suma juntos. Esta función separa
-- por turno puntual: cruza contact_events (empleado + hora exacta) contra
-- la ventana real de cada turno (fecha + hora_inicio hasta hora_fin, o
-- hasta ahora si sigue abierto), sin asumir nada de la zona horaria del
-- navegador — todo se interpreta en hora Argentina.
--
-- Contempla turnos que cruzan la medianoche (ej. Noche que empieza a las
-- 22:00 y termina a las 06:00 del día siguiente): si hora_fin < hora_inicio,
-- se suma un día a la fecha de cierre.
-- ============================================================

create or replace function admin_activity_por_turno(input_admin_pin text)
returns table(shift_id uuid, contactaron int, contestaron int, cargaron int)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  with ventanas as (
    select
      s.id,
      s.responsable,
      (s.fecha + s.hora_inicio) at time zone 'America/Argentina/Buenos_Aires' as inicio,
      case
        when s.hora_fin is null then now()
        when s.hora_fin < s.hora_inicio then ((s.fecha + 1) + s.hora_fin) at time zone 'America/Argentina/Buenos_Aires'
        else (s.fecha + s.hora_fin) at time zone 'America/Argentina/Buenos_Aires'
      end as fin
    from shifts s
  )
  select
    v.id as shift_id,
    count(*) filter (where split_part(ce.accion, ':', 2) <> 'nuevo')::int as contactaron,
    count(*) filter (where split_part(ce.accion, ':', 2) in ('contestado', 'interesado', 'cargado'))::int as contestaron,
    count(*) filter (where split_part(ce.accion, ':', 2) = 'cargado')::int as cargaron
  from ventanas v
  left join contact_events ce
    on ce.empleado = v.responsable
    and (ce.accion like 'estado:%' or ce.accion like 'urgente:%')
    and ce.created_at >= v.inicio
    and ce.created_at < v.fin
  group by v.id;
end;
$function$;
