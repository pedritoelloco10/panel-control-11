-- ============================================================
-- CRM de Bases — Parte 6c: estadísticas por empleado/fecha desde el
-- historial real (contact_events), no desde el último toque del contacto
-- Correr en Supabase → SQL Editor → Run.
--
-- Problema real detectado: "cuántos mensajes mandó cada uno por turno"
-- (pestaña Análisis → por empleado / por fecha, y el historial de
-- refuerzos) se calculaba de `contacts.trabajada_por` / `fecha_trabajo` —
-- dos columnas que representan solo el ÚLTIMO toque de cada contacto, no
-- un historial. Si un contacto queda "contactado" sin respuesta y al otro
-- día el reparto se lo asigna a otra persona (esto puede pasar apenas
-- cambia el día, sin esperar los días de reciclado configurados) y esa
-- persona lo vuelve a tocar, se pisa el dato de quién lo trabajó el día
-- anterior — ese mensaje desaparece de las estadísticas de quien lo mandó
-- primero.
--
-- `contact_events` en cambio nunca se pisa: cada vez que alguien marca un
-- estado queda una fila nueva, para siempre. Esta función agrupa esas
-- filas por empleado y fecha (hora Argentina) y devuelve los mismos 3
-- números que ya se mostraban (contactaron/contestaron/cargaron), ahora
-- sacados del historial real.
--
-- No se toca ninguna tabla ni columna existente — es una función nueva,
-- de solo lectura. `contacts.trabajada_por`/`fecha_trabajo` siguen
-- existiendo y actualizándose igual que antes (los sigue usando, por
-- ejemplo, "Últ. 3 días" en Resultados por base, que sí es una foto del
-- estado actual y no tiene este problema).
-- ============================================================

create or replace function admin_activity_por_empleado_fecha(input_admin_pin text)
returns table(empleado text, fecha date, contactaron int, contestaron int, cargaron int)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select
    e.empleado,
    (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
    count(*) filter (where e.resultado <> 'nuevo')::int as contactaron,
    count(*) filter (where e.resultado in ('contestado', 'interesado', 'cargado'))::int as contestaron,
    count(*) filter (where e.resultado = 'cargado')::int as cargaron
  from (
    select contact_events.empleado, contact_events.created_at, split_part(contact_events.accion, ':', 2) as resultado
    from contact_events
    where (contact_events.accion like 'estado:%' or contact_events.accion like 'urgente:%')
      and contact_events.empleado is not null and contact_events.empleado <> 'sistema'
  ) e
  group by e.empleado, (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date;
end;
$function$;
