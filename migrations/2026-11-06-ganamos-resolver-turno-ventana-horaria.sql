-- ============================================================
-- Fix del bug real detrás de "la importación automática de Ganamos
-- nunca encuentra el turno": comparaba hora_inicio EXACTA (06:00:00 en
-- punto), pero los turnos casi nunca arrancan justo en punto — un
-- turno real queda "06:07:00", "14:03:00", "22:08:00", etc. Con
-- igualdad exacta, esa búsqueda siempre devolvía null, por eso la
-- automatización nunca tenía nada para cargar y terminaba avisando
-- que había que hacerlo a mano.
--
-- Se cambia a una ventana de ±60 minutos alrededor de la hora objetivo
-- (06:00, 14:00 o 22:00) — de sobra para cubrir el atraso real de
-- hasta 30 min que mencionaste, y sin riesgo de pisar el turno
-- siguiente (los turnos están separados por 8 horas).
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================

create or replace function ganamos_import_resolver_turno(
  input_token text, p_fecha date, p_hora_inicio time
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not (verify_admin_pin(input_token) or verify_ganamos_import_token(input_token)) then
    return null;
  end if;

  select id into v_id
  from shifts
  where status = 'cerrado' and archivado = false
    and fecha = p_fecha
    and hora_inicio between (p_hora_inicio - interval '60 minutes') and (p_hora_inicio + interval '60 minutes')
  order by cerrado_at desc nulls last
  limit 1;

  return v_id;
end;
$function$;
