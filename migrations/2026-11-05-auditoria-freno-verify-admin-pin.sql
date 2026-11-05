-- ============================================================
-- Auditoría de seguridad — mover el freno de fuerza bruta a
-- verify_admin_pin, no solo a admin_login.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hoy el freno de 10 intentos / 5 min (migración paso2, 2026-10-10) vive
-- SOLO en admin_login. Pero verify_admin_pin se llama directo desde
-- ~40 funciones más (admin_list_shifts_cerrados, etc.), y esas también
-- quedan expuestas como RPC con la clave pública — alguien podría
-- probar el PIN a fuerza bruta llamando a CUALQUIERA de esas 40 en vez
-- de admin_login, salteándose el freno por completo.
--
-- Esta migración mueve el freno adentro de verify_admin_pin mismo
-- (mismo login_attempts, mismos números: 10 intentos / 5 min, mismo
-- pg_sleep) así que ahora CUALQUIER camino que termine llamando a
-- verify_admin_pin comparte el mismo contador. admin_login se simplifica
-- para no duplicar el freno (ya lo hace verify_admin_pin) y solo agrega
-- el registro en access_log cuando el PIN es correcto, como antes.
--
-- No cambia el comportamiento en el camino correcto: un PIN bien puesto
-- sigue funcionando exactamente igual, solo se le suma una consulta
-- count(*) barata antes de comparar.
-- ============================================================

create or replace function verify_admin_pin(input_pin text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare intentos_recientes int; ok boolean;
begin
  delete from login_attempts where created_at < now() - interval '1 hour';

  select count(*) into intentos_recientes from login_attempts
  where tipo = 'admin' and created_at > now() - interval '5 minutes';

  if intentos_recientes >= 10 then
    perform pg_sleep(1);
    return false;
  end if;

  select exists (
    select 1 from app_settings
    where key = 'admin_pin_hash' and value = extensions.crypt(input_pin, value)
  ) into ok;

  if not ok then
    insert into login_attempts (tipo) values ('admin');
    perform pg_sleep(0.5);
  end if;

  return ok;
end;
$function$;

-- admin_login ya no necesita su propio freno (ahora lo hace verify_admin_pin) —
-- se simplifica para no contar los intentos fallidos dos veces.
create or replace function admin_login(input_pin text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare ok boolean;
begin
  select verify_admin_pin(input_pin) into ok;
  if ok then
    insert into access_log (tipo, nombre) values ('admin', 'Admin');
  end if;
  return ok;
end;
$function$;

-- Chequeo: con el PIN real tiene que devolver true; con uno inventado, false,
-- y a partir del intento #10 en 5 minutos, false aunque pongas el PIN real.
-- select verify_admin_pin('el_pin_real');
