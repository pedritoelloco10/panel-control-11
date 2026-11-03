-- ============================================================
-- Arreglo urgente: admin_importar_ganamos_operaciones quedó duplicada.
-- Correr en Supabase → SQL Editor → Run — ANTES de seguir importando nada.
--
-- Qué pasó: al agregarle el parámetro "nuevo_saldo_gana" con
-- CREATE OR REPLACE, Postgres no reemplaza una función si cambia la
-- cantidad de parámetros — crea una función nueva, superpuesta, y deja
-- la vieja (de 3 parámetros, sin el saldo ni el bono devuelto en texto[])
-- funcionando en paralelo. Con dos versiones activas a la vez, el sistema
-- puede terminar llamando a la que no corresponde, con comportamiento
-- impredecible.
--
-- Esto borra explícitamente las dos firmas viejas conocidas y deja
-- UNA sola versión final.
-- ============================================================

drop function if exists admin_importar_ganamos_operaciones(text, uuid, jsonb);
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

-- Chequeo: después de correr esto, esta consulta tiene que devolver UNA sola fila.
-- select proname, pronargs from pg_proc where proname = 'admin_importar_ganamos_operaciones';
