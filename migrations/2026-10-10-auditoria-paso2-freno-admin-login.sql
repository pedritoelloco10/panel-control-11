-- ============================================================
-- Auditoría de seguridad — Paso 2: freno de intentos en admin_login.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hoy admin_login no tiene NINGÚN freno: ni delay, ni tope de intentos, ni
-- registro de los que fallan (access_log solo recibe una fila cuando el
-- PIN es correcto). Un PIN de 4 dígitos (10.000 combinaciones) sin
-- ninguna fricción se prueba entero en segundos con un script.
--
-- Esta migración:
--   1. Crea login_attempts — tabla nueva, cerrada a la API pública
--      (RLS sin políticas, mismo patrón que sessions/employees), donde
--      se registra cada intento FALLIDO (de admin o empleado — el campo
--      `tipo` ya queda listo para cuando se refuerce verify_employee_pin
--      en el próximo paso).
--   2. Reemplaza admin_login: si hubo 10 o más intentos fallidos de admin
--      en los últimos 5 minutos, bloquea de una (ni siquiera revisa el
--      PIN). Si el PIN está mal, lo registra y espera 0.5s antes de
--      responder. Si está bien, sigue exactamente igual que antes
--      (access_log, etc.) — no cambia el comportamiento en el camino
--      correcto, solo frena el camino de fuerza bruta.
-- ============================================================

create table if not exists login_attempts (
  id bigserial primary key,
  tipo text not null, -- 'admin' | 'empleado'
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_tipo_created_idx on login_attempts (tipo, created_at);
alter table login_attempts enable row level security;
-- Sin políticas = cerrada del todo a la API pública (mismo patrón que
-- sessions/employees/access_log) — solo la tocan las funciones de abajo.

create or replace function admin_login(input_pin text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ok boolean; intentos_recientes int;
begin
  delete from login_attempts where created_at < now() - interval '1 hour';

  select count(*) into intentos_recientes from login_attempts
  where tipo = 'admin' and created_at > now() - interval '5 minutes';

  if intentos_recientes >= 10 then
    perform pg_sleep(1);
    return false;
  end if;

  select verify_admin_pin(input_pin) into ok;

  if ok then
    insert into access_log (tipo, nombre) values ('admin', 'Admin');
  else
    insert into login_attempts (tipo) values ('admin');
    perform pg_sleep(0.5);
  end if;

  return ok;
end;
$function$;
