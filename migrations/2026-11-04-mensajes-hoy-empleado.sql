-- ============================================================
-- Contador de mensajes de publicidad para la pantalla única del empleado.
-- Correr en Supabase → SQL Editor → Run. Es un archivo nuevo, aparte del de
-- Ganamos — no hace falta volver a correr ese.
--
-- Por qué una función nueva y no reusar session_get_leads: esa función NO es
-- de solo lectura — reparte leads nuevos, recicla contactos vencidos y toma
-- un lock cada vez que se llama (es lo que ya usa Bases para repartir). Si la
-- pantalla de Turno la llamara también, cada vez que el empleado mire su
-- turno le estaría "gastando" reparto de Bases sin que esa sea la intención.
-- Esta función de acá es pura lectura: solo cuenta, no mueve nada.
-- ============================================================

create or replace function session_mis_mensajes_hoy(input_token uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_count int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return 0;
  end if;

  select count(*) into v_count from contacts
  where trabajada_por = emp.nombre and fecha_trabajo = current_date and enviado = true;

  return v_count;
end;
$function$;
