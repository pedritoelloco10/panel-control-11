-- ============================================================
-- Deshacer una importación de Ganamos cargada al turno equivocado.
-- Correr en Supabase → SQL Editor → Run.
--
-- admin_deshacer_importacion_ganamos: saca del turno TODAS las
-- operaciones que tengan "ganamos_tx" (es decir, todo lo que vino de una
-- importación de Ganamos) — deja intactas las que el empleado cargó a
-- mano (registro_rapido, o cargas de Bet). Después de correr esto, los
-- mismos ganamos_tx ya no están en el turno, así que se pueden volver a
-- importar al turno correcto sin que el dedupe los bloquee.
-- ============================================================

create or replace function admin_deshacer_importacion_ganamos(input_admin_pin text, target_shift_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ops_actuales jsonb;
  v_ops_filtradas jsonb;
  v_quitadas int;
begin
  if not verify_admin_pin(input_admin_pin) then
    return -1;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return -1;
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is null;

  v_quitadas := jsonb_array_length(v_ops_actuales) - jsonb_array_length(v_ops_filtradas);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_quitadas;
end;
$function$;
