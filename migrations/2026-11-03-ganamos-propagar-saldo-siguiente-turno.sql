-- ============================================================
-- Propagar automáticamente el saldo real de Ganamos al turno siguiente.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hasta ahora, cuando se cargaba el saldo real de Ganamos al cierre de un
-- turno, el turno que se abría después seguía arrancando con el número
-- viejo (las fichas de inicio se fijan una sola vez, al abrir, y no se
-- actualizaban solas). Esto obligaba a corregirlo a mano cada vez —
-- depender de que alguien se acuerde de hacerlo a mano es un riesgo real
-- (errores, o peor).
--
-- Ahora, cada vez que se confirma un saldo real de Ganamos para un
-- turno, se busca el turno siguiente (el que se abrió justo después, el
-- más próximo por fecha de creación) y se le actualizan sus fichas de
-- inicio de Ganamos con ese mismo número — automático, sin que nadie
-- tenga que acordarse de nada.
--
-- Misma firma que la versión anterior (4 parámetros, devuelve text[]),
-- así que alcanza con reemplazarla.
-- ============================================================

create or replace function admin_importar_ganamos_operaciones(
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
  v_creado_at timestamptz;
  v_siguiente_id uuid;
begin
  if not verify_admin_pin(input_admin_pin) then
    return null;
  end if;

  select ops, created_at into v_ops_actuales, v_creado_at from shifts where id = target_shift_id and status = 'cerrado' for update;
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

  -- Propagar el saldo real al turno siguiente (el que se abrió justo después de este,
  -- el próximo por fecha de creación, sin importar si ya cerró o sigue abierto).
  if nuevo_saldo_gana is not null then
    select id into v_siguiente_id
      from shifts
      where archivado = false and created_at > v_creado_at
      order by created_at asc limit 1;

    if v_siguiente_id is not null then
      update shifts set
        stock_inicio = jsonb_set(coalesce(stock_inicio, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana)),
        updated_at = now()
      where id = v_siguiente_id;
    end if;
  end if;

  return v_tx_agregados;
end;
$function$;
