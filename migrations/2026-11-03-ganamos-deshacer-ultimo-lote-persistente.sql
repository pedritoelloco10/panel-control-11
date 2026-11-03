-- ============================================================
-- El deshacer "último lote" dependía de memoria del navegador (el estado
-- ultimoLote de React) — si se recargaba la página o se volvía más tarde,
-- se perdía, y solo quedaba la opción de deshacer TODO lo de Ganamos del
-- turno (que también borra importaciones viejas correctas).
--
-- Ahora cada operación importada queda marcada con el momento exacto de
-- ESA importación puntual (_lote). admin_deshacer_ultimo_lote_ganamos
-- busca, para un turno, el lote más reciente entre sus operaciones de
-- Ganamos y saca solo esas — sin importar si pasó por el navegador o no.
-- Correr en Supabase → SQL Editor → Run.
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
  v_lote text := extract(epoch from clock_timestamp())::text;
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

  select coalesce(jsonb_agg(elem || jsonb_build_object('_lote', v_lote)), '[]'::jsonb)
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

create or replace function admin_deshacer_ultimo_lote_ganamos(input_admin_pin text, target_shift_id uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ops_actuales jsonb;
  v_ultimo_lote text;
  v_ops_filtradas jsonb;
  v_tx_sacados text[];
begin
  if not verify_admin_pin(input_admin_pin) then
    return null;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return null;
  end if;

  select max(elem->>'_lote')
    into v_ultimo_lote
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null and elem->>'_lote' is not null;

  if v_ultimo_lote is null then
    return '{}';
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_sacados
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null and elem->>'_lote' = v_ultimo_lote;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(v_ops_actuales) as elem
    where not (elem->>'ganamos_tx' is not null and elem->>'_lote' = v_ultimo_lote);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_tx_sacados;
end;
$function$;
