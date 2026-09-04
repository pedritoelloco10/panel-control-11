-- ============================================================
-- CRM de Bases — Parte 5 (SQL previo): costo por base
-- Correr en Supabase → SQL Editor → Run.
--
-- Faltó en la Parte 3: una forma de cargar/editar `databases.costo`
-- (la columna ya existe desde la Parte 1, pero no había ninguna función
-- que la tocara). Se agrega:
--   - admin_set_base_costo: para editar el costo de una base existente.
--   - admin_create_base: se le agrega un parámetro nuevo `nuevo_costo`
--     (con default 0, al final) para poder cargarlo ya al crearla —
--     agregar un parámetro con default al final es compatible con
--     CREATE OR REPLACE, no hace falta un DROP como con
--     admin_import_contacts.
-- ============================================================

create or replace function admin_set_base_costo(input_admin_pin text, target_id uuid, nuevo_costo numeric)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update databases set costo = nuevo_costo where id = target_id;
  return true;
end;
$function$;

create or replace function admin_create_base(input_admin_pin text, nombre text, tipo_fuente text, nuevo_costo numeric default 0)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  insert into databases (nombre, tipo, tipo_fuente, costo) values (nombre, 'comprada', tipo_fuente, nuevo_costo);
  return true;
end;
$function$;
