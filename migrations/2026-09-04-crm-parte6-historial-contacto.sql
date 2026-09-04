-- ============================================================
-- CRM de Bases — Parte 6 (SQL previo): historial completo por contacto
-- Correr en Supabase → SQL Editor → Run.
--
-- Falta una función para que un empleado vea el historial completo
-- (contact_events) de UN contacto puntual — admin_list_events ya existe
-- pero es por base entera y solo para Admin. Esta es equivalente, pero
-- para empleados y restringida a sus propios contactos asignados.
-- ============================================================

create or replace function session_get_contact_events(input_token uuid, target_id uuid)
returns setof contact_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  if not exists (select 1 from contacts where id = target_id and asignado_a = emp.nombre) then
    return;
  end if;

  return query select * from contact_events where contact_id = target_id order by created_at desc;
end;
$function$;
