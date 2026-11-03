-- ============================================================
-- Importación de operaciones desde Ganamos — base para dejar de tipear
-- cada carga/retiro a mano.
-- Correr en Supabase → SQL Editor → Run.
--
-- Qué agrega:
--   1. ganamos_usuarios: mapeo entre el usuario de Ganamos (ej. "ffacundo8651")
--      y el nombre + origen (P/R/L) que ya usa el resto del sistema. Se carga
--      una sola vez por usuario, no por operación.
--   2. admin_get_ganamos_usuarios / admin_set_ganamos_usuario: leer y guardar
--      ese mapeo desde el Admin.
--   3. admin_importar_ganamos_operaciones: toma las filas ya parseadas de la
--      tabla de Ganamos (del lado del cliente, en JS) para UN turno puntual
--      y las agrega a shifts.ops, sin duplicar (por el id de transacción de
--      Ganamos, guardado en cada operación como "ganamos_tx").
--
-- Sigue el mismo patrón que ya usan verify_admin_pin / admin_toggle_archivado
-- — nada nuevo, mismo estilo que el resto del archivo de funciones admin.
--
-- RLS: ganamos_usuarios nace con RLS activado y SIN ninguna política pública
-- — accesible solo a través de estas 2 funciones (igual que shifts/app_config
-- después del blindaje de seguridad).
-- ============================================================

create table if not exists ganamos_usuarios (
  usuario text primary key,
  cliente text not null,
  origen text not null check (origen in ('nuevo', 'derivado', 'lista')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ganamos_usuarios enable row level security;

create or replace function admin_get_ganamos_usuarios(input_admin_pin text)
returns setof ganamos_usuarios
language sql
security definer
set search_path to 'public'
as $function$
  select * from ganamos_usuarios
  where verify_admin_pin(input_admin_pin) = true
  order by updated_at desc;
$function$;

create or replace function admin_set_ganamos_usuario(input_admin_pin text, p_usuario text, p_cliente text, p_origen text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  insert into ganamos_usuarios (usuario, cliente, origen, updated_at)
  values (p_usuario, p_cliente, p_origen, now())
  on conflict (usuario) do update set
    cliente = excluded.cliente, origen = excluded.origen, updated_at = now();
  return true;
end;
$function$;

-- nuevas_ops: array de objetos {tipo, plataforma, monto, bono, cliente, origen, ganamos_tx}
-- (misma forma que ya usa shifts.ops, con el campo extra ganamos_tx para dedupe).
-- Se descartan las que ya estén en el turno (mismo ganamos_tx), así importar
-- el mismo día dos veces no duplica nada.
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

  select ops into v_ops_actuales from shifts where id = target_shift_id;
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
