-- ============================================================
-- Auditoría de seguridad — Paso 3: tope real de intentos en
-- verify_employee_pin (hoy solo tenía un delay de 0.3s, sin límite).
-- Correr en Supabase → SQL Editor → Run.
--
-- Mismo patrón que admin_login (paso 2): reusa la tabla login_attempts
-- ya creada. El umbral es más alto que el de admin (15 en vez de 10)
-- porque acá varios empleados distintos comparten el mismo contador —
-- no queremos que typos normales de gente distinta bloqueen a todos.
-- Igual sigue siendo una mejora enorme: hoy no hay tope ninguno.
--
-- El camino correcto (PIN bien escrito) queda exactamente igual que
-- antes — misma sesión, mismo access_log, mismo cierre de
-- refuerzo_sessions.
-- ============================================================

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

  select e.id, e.nombre into emp from employees e where e.pin = input_pin and e.activo = true limit 1;
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
