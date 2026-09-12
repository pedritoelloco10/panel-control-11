-- ============================================================
-- Publicidad: botón "−" y total por turno específico
-- Correr en Supabase → SQL Editor → Run.
--
-- 1. session_remove_publicidad_evento — borra el evento más reciente
--    cargado por ESE MISMO empleado (nunca uno de otra persona), para
--    poder corregir un doble click sin pedirle nada a Admin.
--
-- 2. admin_publicidad_por_turno — mismo patrón que
--    admin_activity_por_turno (Parte 6e de Bases): cruza
--    publicidad_eventos (empleado + hora exacta) contra la ventana real
--    de cada turno (fecha + hora_inicio hasta hora_fin, contemplando
--    turnos que cruzan la medianoche), para mostrar el total de
--    mensajes de publicidad de ESE turno puntual, no solo del día.
-- ============================================================

create or replace function session_remove_publicidad_evento(input_token uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  select id into v_id from publicidad_eventos
  where empleado = emp.nombre
  order by created_at desc
  limit 1;

  if v_id is null then return false; end if;

  delete from publicidad_eventos where id = v_id;
  return true;
end;
$function$;

create or replace function admin_publicidad_por_turno(input_admin_pin text)
returns table(shift_id uuid, cantidad int)
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
  select v.id as shift_id, count(pe.id)::int as cantidad
  from ventanas v
  left join publicidad_eventos pe
    on pe.empleado = v.responsable
    and pe.created_at >= v.inicio
    and pe.created_at < v.fin
  group by v.id;
end;
$function$;
