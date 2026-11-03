-- ============================================================
-- Auditoría — 2 arreglos en admin_importar_ganamos_operaciones.
-- Correr en Supabase → SQL Editor → Run.
--
-- 1. Agrega "for update" al select del turno: sin esto, si la función se
--    llama dos veces casi al mismo tiempo para el mismo turno (doble click,
--    dos pestañas), ambas leen el mismo estado viejo y la segunda escritura
--    pisa a la primera — se podían perder operaciones ya importadas en
--    silencio. Con el lock, la segunda llamada espera a que termine la
--    primera y recién ahí lee el estado ya actualizado.
-- 2. Agrega "and status = 'cerrado'" a la condición: la pantalla ya filtra
--    para no ofrecer turnos abiertos, pero la función en sí no lo exigía —
--    alguien llamándola directo con el PIN de admin podía importar a un
--    turno abierto, justo el caso que se quería evitar por el autoguardado
--    del empleado (ver comentario en GanamosImportTab.jsx).
-- ============================================================

create or replace function admin_importar_ganamos_operaciones(input_admin_pin text, target_shift_id uuid, nuevas_ops jsonb)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ops_actuales jsonb;
  v_tx_existentes text[];
  v_ops_filtradas jsonb;
  v_agregadas int;
begin
  if not verify_admin_pin(input_admin_pin) then
    return -1;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return -1;
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_existentes
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(nuevas_ops) as elem
    where elem->>'ganamos_tx' is null or not (elem->>'ganamos_tx' = any(v_tx_existentes));

  v_agregadas := jsonb_array_length(v_ops_filtradas);

  update shifts set
    ops = v_ops_actuales || v_ops_filtradas,
    updated_at = now()
  where id = target_shift_id;

  return v_agregadas;
end;
$function$;
