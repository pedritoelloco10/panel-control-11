-- ============================================================
-- Auditoría de seguridad — Paso 1A (parte 2): funciones para que un
-- empleado pueda abrir turno sin lectura pública de shifts.
-- Correr en Supabase → SQL Editor → Run.
--
-- Al revisar el cierre de shifts (Paso 1B) encontré que useTurnoDraft.js
-- (el flujo de "abrir turno", que corre para CADA empleado al entrar)
-- también lee la tabla shifts directo 4 veces — no solo AdminDashboard.jsx.
-- Si se cierra la lectura pública sin esto, nadie podría abrir un turno.
--
-- Estas 3 funciones (la 4ta lectura reusa la 2da función, es la misma
-- consulta) exigen un token de sesión de empleado válido en vez de nada:
--
--   session_mi_turno_abierto       -> reemplaza "mine" (línea 57-59)
--   session_turno_abierto_actual   -> reemplaza "anyOpen" (línea 99-101) y
--                                      el re-chequeo tras la carrera (línea 164-166)
--   session_ultimo_cierre_arrastre -> reemplaza "lastClosed" (línea 126-130)
--
-- Puramente aditivo — no cierra nada todavía.
-- ============================================================

create or replace function session_mi_turno_abierto(input_token uuid)
returns setof shifts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  order by created_at desc limit 1;
end;
$function$;

create or replace function session_turno_abierto_actual(input_token uuid)
returns setof shifts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'abierto' and archivado = false
  order by created_at desc limit 1;
end;
$function$;

create or replace function session_ultimo_cierre_arrastre(input_token uuid)
returns setof shifts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'cerrado' and archivado = false
    and cerrado_at is not null
    and excluir_arrastre is not true
  order by cerrado_at desc nulls last limit 1;
end;
$function$;
