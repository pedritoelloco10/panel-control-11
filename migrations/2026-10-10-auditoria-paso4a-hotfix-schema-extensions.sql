-- ============================================================
-- Auditoría de seguridad — Paso 4A (HOTFIX): crypt()/gen_salt() viven en
-- el schema `extensions`, no en `public`.
-- Correr en Supabase → SQL Editor → Run — URGENTE, esto está rompiendo
-- el login de todos los empleados ahora mismo.
--
-- verify_admin_pin ya hacía esto bien (SET search_path TO 'public',
-- 'extensions' + extensions.crypt(...)) pero las 4 funciones nuevas del
-- paso 4A solo tenían SET search_path TO 'public' y llamaban crypt()/
-- gen_salt() sin calificar el schema — adentro de una función
-- security definer eso NO cae al search_path de la sesión, así que no
-- las encontraba y la función fallaba con error en vez de simplemente
-- no encontrar el PIN.
--
-- Este script re-crea las mismas 4 funciones, idénticas en lógica,
-- solo corrigiendo dónde buscan crypt()/gen_salt().
-- ============================================================

create or replace function empleado_pin_en_uso(check_pin text, excluir_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  return exists (
    select 1 from employees
    where activo = true
      and (excluir_id is null or id <> excluir_id)
      and pin_hash = extensions.crypt(check_pin, pin_hash)
  );
end;
$function$;

create or replace function verify_employee_pin(input_pin text)
returns table(id uuid, nombre text, token uuid)
language plpgsql
security definer
set search_path to 'public', 'extensions'
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
  where e.activo = true and e.pin_hash = extensions.crypt(input_pin, e.pin_hash)
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
set search_path to 'public', 'extensions'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if empleado_pin_en_uso(new_pin) then return false; end if;
  insert into employees (nombre, pin_hash, recibe_leads, cupo_leads)
  values (new_nombre, extensions.crypt(new_pin, extensions.gen_salt('bf')), new_recibe_leads, new_cupo_leads);
  return true;
end;
$function$;

create or replace function admin_update_employee(input_admin_pin text, target_id uuid, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if new_pin is not null and new_pin <> '' and empleado_pin_en_uso(new_pin, target_id) then return false; end if;

  update employees set
    nombre = new_nombre,
    pin_hash = case when new_pin is not null and new_pin <> '' then extensions.crypt(new_pin, extensions.gen_salt('bf')) else pin_hash end,
    recibe_leads = new_recibe_leads,
    cupo_leads = new_cupo_leads
  where id = target_id;
  return true;
end;
$function$;
