-- ============================================================
-- Marcar el saldo de Ganamos importado como "real" para el arrastre.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hasta ahora, cuando se abría un turno nuevo, arrastraba las fichas GANA
-- de cierre del turno anterior tal cual estuvieran — que, si Admin
-- todavía no había importado ese turno, era solo la estimación interna
-- en vivo (no un dato real), y esa estimación venía arrastrando mal.
--
-- Ahora se agrega una marca "G_real" al stock_cierre cuando Admin importa
-- el saldo real de Ganamos. El cliente (useTurnoDraft.js) usa esa marca
-- para decidir: si el turno anterior ya tiene saldo real (G_real), lo usa
-- tal cual; si no, prefiere lo que el empleado anotó al cerrar
-- (G_reportado) antes que la estimación interna sin verificar.
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
      when nuevo_saldo_gana is not null then
        jsonb_set(
          jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana)),
          '{G_real}', 'true'::jsonb
        )
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
