-- ============================================================
-- El origen (P/R/L) deja de pedirse al importar Ganamos — ese dato lo va a
-- cargar el empleado en su pantalla (carga rápida), no el admin al importar.
-- Correr en Supabase → SQL Editor → Run.
--
-- ganamos_usuarios pasa a guardar solo usuario↔cliente; origen queda
-- opcional (se completa más adelante, cruzando contra lo que anotó el
-- empleado — ver cruzarRegistrosConGanamos en lib.js).
-- ============================================================

alter table ganamos_usuarios alter column origen drop not null;

create or replace function admin_set_ganamos_usuario(input_admin_pin text, p_usuario text, p_cliente text, p_origen text default null)
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
    cliente = excluded.cliente, origen = coalesce(excluded.origen, ganamos_usuarios.origen), updated_at = now();
  return true;
end;
$function$;
