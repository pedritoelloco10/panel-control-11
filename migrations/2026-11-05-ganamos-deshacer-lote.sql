-- ============================================================
-- Deshacer con precisión: solo las operaciones que de verdad agregó la
-- última importación puntual — ni todo lo de Ganamos del turno (que podía
-- incluir importaciones anteriores correctas), ni las que ese lote
-- "intentó" importar pero ya estaban de antes (duplicadas, se saltearon
-- solas y no hay que tocarlas al deshacer).
-- Correr en Supabase → SQL Editor → Run.
--
-- admin_importar_ganamos_operaciones cambia de devolver un conteo (int) a
-- devolver la lista de ganamos_tx que agregó de verdad (text[]) — así el
-- cliente sabe EXACTAMENTE qué deshacer después, no solo cuántas fueron.
-- Hay que borrar la versión vieja primero porque Postgres no deja
-- cambiar el tipo de retorno con CREATE OR REPLACE.
--
-- admin_quitar_operaciones_ganamos: saca de un turno únicamente las
-- operaciones cuyo ganamos_tx esté en la lista que se le pasa.
-- ============================================================

drop function if exists admin_importar_ganamos_operaciones(text, uuid, jsonb, text);

create function admin_importar_ganamos_operaciones(
  input_admin_pin text, target_shift_id uuid, nuevas_ops jsonb,
  nuevo_saldo_gana text default null
)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ops_actuales jsonb;
  v_tx_existentes text[];
  v_ops_filtradas jsonb;
  v_tx_agregados text[];
begin
  if not verify_admin_pin(input_admin_pin) then
    return null;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return null;
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_existentes
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(nuevas_ops) as elem
    where elem->>'ganamos_tx' is null or not (elem->>'ganamos_tx' = any(v_tx_existentes));

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_agregados
    from jsonb_array_elements(v_ops_filtradas) as elem
    where elem->>'ganamos_tx' is not null;

  update shifts set
    ops = v_ops_actuales || v_ops_filtradas,
    stock_cierre = case
      when nuevo_saldo_gana is not null then jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana))
      else stock_cierre
    end,
    updated_at = now()
  where id = target_shift_id;

  return v_tx_agregados;
end;
$function$;

create or replace function admin_quitar_operaciones_ganamos(input_admin_pin text, target_shift_id uuid, tx_a_quitar text[])
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
    where not (elem->>'ganamos_tx' = any(tx_a_quitar));

  v_quitadas := jsonb_array_length(v_ops_actuales) - jsonb_array_length(v_ops_filtradas);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_quitadas;
end;
$function$;
