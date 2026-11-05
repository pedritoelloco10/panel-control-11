-- ============================================================
-- Función de un solo propósito: dada una fecha y hora de inicio (lo que
-- la automatización ya sabe, por el horario fijo de los turnos), devuelve
-- SOLO el ID del turno cerrado que coincide — nada más. No es una
-- función de lectura general: no se puede listar ni buscar turnos con
-- esto, solo confirmar "¿existe este turno puntual, y cuál es su ID?".
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
    and fecha = p_fecha and hora_inicio = p_hora_inicio
  order by cerrado_at desc nulls last
  limit 1;

  return v_id;
end;
$function$;

-- Además, se marca cada lote importado con quién lo cargó (admin real o
-- el código automático), para que quede trazable después. No cambia la
-- firma de la función — sigue aceptando los mismos parámetros de siempre.
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
  v_via_admin boolean;
  v_origen text;
begin
  v_via_admin := verify_admin_pin(input_admin_pin);
  if not (v_via_admin or verify_ganamos_import_token(input_admin_pin)) then
    return null;
  end if;
  v_origen := case when v_via_admin then 'admin' else 'auto' end;

  select ops, created_at into v_ops_actuales, v_creado_at from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return null;
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_existentes
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null;

  select coalesce(jsonb_agg(elem || jsonb_build_object('_lote', v_lote, '_lote_origen', v_origen)), '[]'::jsonb)
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
      when nuevo_saldo_gana is not null then
        jsonb_set(
          jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana)),
          '{G_real}', 'true'::jsonb
        )
      else stock_cierre
    end,
    updated_at = now()
  where id = target_shift_id;

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
