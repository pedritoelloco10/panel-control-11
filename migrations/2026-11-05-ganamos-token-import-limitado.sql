-- ============================================================
-- Código separado, de permisos limitados, solo para la automatización
-- de Ganamos — distinto del PIN de admin de verdad.
-- Correr en Supabase → SQL Editor → Run.
--
-- Este código SOLO sirve para admin_importar_ganamos_operaciones. No
-- funciona en ninguna otra función de admin (no puede borrar, editar
-- empleados, billeteras, turnos, nada) — a propósito, para que la
-- automatización tenga el mínimo acceso posible.
--
-- El PIN de admin de siempre (el de vos y tu socio) sigue funcionando
-- exactamente igual en admin_importar_ganamos_operaciones — esto solo
-- AGREGA una segunda puerta posible, no reemplaza la que ya había.
-- ============================================================

-- Guarda el código hasheado (igual que el PIN de admin), bajo una key
-- nueva en app_settings — no toca 'admin_pin_hash'.
insert into app_settings (key, value) values ('ganamos_import_token_hash', '')
  on conflict (key) do nothing;

-- Poné acá el código real (el que te paso en el chat, guardalo aparte —
-- NUNCA lo escribas en este archivo si lo vas a subir a GitHub, un secreto
-- así no debe quedar en el código versionado). Pegalo directo en el SQL
-- Editor de Supabase con el valor real, pero no lo guardes así en el repo.
update app_settings
set value = extensions.crypt('PONÉ_ACÁ_EL_CÓDIGO_LARGO', extensions.gen_salt('bf'))
where key = 'ganamos_import_token_hash';

create or replace function verify_ganamos_import_token(input_token text)
returns boolean
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  select exists (
    select 1 from app_settings
    where key = 'ganamos_import_token_hash' and value = extensions.crypt(input_token, value)
  );
$function$;

-- Para rotar el código más adelante sin tener que entrar al SQL Editor cada
-- vez — exige el PIN de admin de verdad para poder cambiarlo.
create or replace function admin_set_ganamos_import_token(input_admin_pin text, nuevo_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update app_settings
  set value = extensions.crypt(nuevo_token, extensions.gen_salt('bf'))
  where key = 'ganamos_import_token_hash';
  return true;
end;
$function$;

-- admin_importar_ganamos_operaciones ahora acepta CUALQUIERA de los dos
-- códigos (el PIN de admin de siempre, o este nuevo limitado) — el resto
-- de la función queda exactamente igual.
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
  if not (verify_admin_pin(input_admin_pin) or verify_ganamos_import_token(input_admin_pin)) then
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

-- Chequeo: después de correr esto, esta consulta tiene que devolver UNA sola fila.
-- select proname, pronargs from pg_proc where proname = 'admin_importar_ganamos_operaciones';
