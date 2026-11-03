-- ============================================================
-- El control de "fichas GANA" del cierre de turno hoy compara contra un
-- número que el propio sistema se inventa (calculado de los mismos datos
-- que después lo comparan) — nunca es una foto real de Ganamos, así que
-- nunca puede dar "0" de forma confiable ni detectar un error real.
-- Correr en Supabase → SQL Editor → Run.
--
-- Esto agrega un parámetro opcional a admin_importar_ganamos_operaciones:
-- el "Saldo" real que muestra Ganamos (arriba a la derecha en su panel) al
-- momento de importar. Cuando se manda, pisa stock_cierre.G del turno con
-- ese número real — a partir de ahí, el control de diferencia de fichas
-- GANA que ya existe en Admin (ShiftRow, mismo cálculo de siempre) queda
-- comparando contra algo real en vez de contra sí mismo.
-- ============================================================

create or replace function admin_importar_ganamos_operaciones(
  input_admin_pin text, target_shift_id uuid, nuevas_ops jsonb,
  nuevo_saldo_gana text default null
)
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
    stock_cierre = case
      when nuevo_saldo_gana is not null then jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana))
      else stock_cierre
    end,
    updated_at = now()
  where id = target_shift_id;

  return v_agregadas;
end;
$function$;
