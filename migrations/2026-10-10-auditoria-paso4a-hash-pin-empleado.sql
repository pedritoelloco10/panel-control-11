-- ============================================================
-- Auditoría de seguridad — Paso 4A: hashear los PINs de empleado.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hoy employees.pin se guarda en texto plano y se compara con
-- `e.pin = input_pin`. Si alguna vez se filtra un backup o la clave de
-- servicio, los PINs quedan usables tal cual. El PIN de Admin ya estaba
-- bien (hasheado con crypt() en app_settings) — esto extiende lo mismo
-- a los empleados.
--
-- Qué hace:
--   1. Agrega employees.pin_hash y lo llena hasheando el pin actual de
--      cada uno (pgcrypto, bcrypt vía crypt()/gen_salt('bf')).
--   2. empleado_pin_en_uso(): chequeo de duplicados — como el hash no es
--      comparable con un UNIQUE constraint normal (cada hash es distinto
--      aunque el PIN sea igual, por el salt), el chequeo de "¿ya existe
--      este PIN en otro empleado activo?" pasa a hacerse acá, antes de
--      guardar.
--   3. verify_employee_pin: compara por hash en vez de texto plano.
--      Mismo freno de intentos del paso 3/5, sin cambios ahí.
--   4. admin_add_employee / admin_update_employee: hashean el PIN nuevo
--      al guardar. En admin_update_employee, new_pin vacío/null significa
--      "no cambiar el PIN" (antes era obligatorio siempre).
--   5. admin_list_employees: deja de devolver el PIN (ni texto plano ni
--      hash) — Admin ya no necesita ni puede mostrarlo. Como cambia el
--      RETURNS TABLE, hace falta DROP antes del CREATE.
--
-- La columna employees.pin VIEJA (texto plano) queda intacta por ahora,
-- como red de seguridad — ya no la lee ni la escribe ninguna función
-- después de este script. Se borra en el Paso 4B, aparte, una vez
-- confirmado que todo esto anda bien.
-- ============================================================

alter table employees add column if not exists pin_hash text;
update employees set pin_hash = crypt(pin, gen_salt('bf')) where pin_hash is null;
alter table employees alter column pin_hash set not null;

create or replace function empleado_pin_en_uso(check_pin text, excluir_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return exists (
    select 1 from employees
    where activo = true
      and (excluir_id is null or id <> excluir_id)
      and pin_hash = crypt(check_pin, pin_hash)
  );
end;
$function$;

create or replace function verify_employee_pin(input_pin text)
returns table(id uuid, nombre text, token uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; new_token uuid; intentos_recientes int;
begin
  delete from sessions where expires_at < now();
  delete from login_attempts where created_at < now() - interval '1 hour';

  select count(*) into intentos_recientes from login_attempts
  where tipo = 'empleado' and created_at > now() - interval '5 minutes';

  if intentos_recientes >= 15 then
    perform pg_sleep(1);
    return;
  end if;

  select e.id, e.nombre into emp from employees e
  where e.activo = true and e.pin_hash = crypt(input_pin, e.pin_hash)
  limit 1;

  if emp.id is null then
    insert into login_attempts (tipo) values ('empleado');
    perform pg_sleep(0.3);
    return;
  end if;

  delete from sessions where empleado_id = emp.id;
  update refuerzo_sessions set fin = now() where empleado = emp.nombre and fin is null;
  insert into access_log (tipo, nombre) values ('empleado', emp.nombre);

  insert into sessions (empleado_id) values (emp.id) returning sessions.token into new_token;
  return query select emp.id, emp.nombre, new_token;
end;
$function$;

create or replace function admin_add_employee(input_admin_pin text, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if empleado_pin_en_uso(new_pin) then return false; end if;
  insert into employees (nombre, pin_hash, recibe_leads, cupo_leads)
  values (new_nombre, crypt(new_pin, gen_salt('bf')), new_recibe_leads, new_cupo_leads);
  return true;
end;
$function$;

create or replace function admin_update_employee(input_admin_pin text, target_id uuid, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if new_pin is not null and new_pin <> '' and empleado_pin_en_uso(new_pin, target_id) then return false; end if;

  update employees set
    nombre = new_nombre,
    pin_hash = case when new_pin is not null and new_pin <> '' then crypt(new_pin, gen_salt('bf')) else pin_hash end,
    recibe_leads = new_recibe_leads,
    cupo_leads = new_cupo_leads
  where id = target_id;
  return true;
end;
$function$;

drop function if exists admin_list_employees(text);
create or replace function admin_list_employees(input_admin_pin text)
returns table(id uuid, nombre text, activo boolean, recibe_leads boolean, cupo_leads int)
language sql
security definer
set search_path to 'public'
as $function$
  select e.id, e.nombre, e.activo, e.recibe_leads, e.cupo_leads from employees e
  where verify_admin_pin(input_admin_pin) = true
  order by e.created_at;
$function$;
