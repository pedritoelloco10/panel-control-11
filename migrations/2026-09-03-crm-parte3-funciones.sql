-- ============================================================
-- CRM de Bases — Parte 3: funciones nuevas
-- Correr en Supabase → SQL Editor → Run.
-- Requiere que las Partes 1 y 2 ya estén corridas.
--
-- Contenido:
--   1. admin_toggle_base_activa      — pausar/reactivar una base entera
--   2. session_toggle_pausado        — pausar/despausar un contacto (empleado, propio)
--   3. admin_toggle_pausado          — ídem, desde Admin, cualquier contacto
--   4. session_set_nota              — notas libres (empleado, propio)
--   5. session_add_reminder          — crear recordatorio (empleado, propio)
--   6. session_list_reminders_pendientes — cola personal de recordatorios vencidos
--   7. session_complete_reminder     — marcar recordatorio atendido
--   8. admin_search_contacts         — buscador global (nombre o teléfono)
--   9. admin_import_contacts         — reescrita: detecta duplicados por teléfono
--      contra TODOS los contactos existentes, devuelve insertados/duplicados
--      en vez de solo un conteo.
--  10-12. session_set_estado, session_claim_urgent, admin_mark_seguimiento —
--      se agregan a las 3 la actualización de `ultimo_evento_resumen`, y a
--      admin_mark_seguimiento además el registro en contact_events que le
--      faltaba (y estado_actualizado_at, que tampoco tocaba).
--
-- Todas siguen exactamente el mismo patrón que ya usa el resto del sistema:
-- session_employee(input_token) + chequeo de propiedad (asignado_a = emp.nombre)
-- para las de empleado, verify_admin_pin(input_admin_pin) para las de Admin.
-- ============================================================

-- ---------- 1. Pausar/reactivar una base entera ----------
create or replace function admin_toggle_base_activa(input_admin_pin text, target_id uuid, nueva_activa boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update databases set activa = nueva_activa where id = target_id;
  return true;
end;
$function$;

-- ---------- 2. Pausar/despausar un contacto (empleado, propio) ----------
create or replace function session_toggle_pausado(input_token uuid, target_id uuid, nuevo_pausado boolean, motivo text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    pausado = nuevo_pausado,
    motivo_pausa = case when nuevo_pausado then motivo else null end
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, case when nuevo_pausado then 'pausado' else 'despausado' end,
      case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

-- ---------- 3. Pausar/despausar un contacto (Admin, cualquiera) ----------
create or replace function admin_toggle_pausado(input_admin_pin text, target_id uuid, nuevo_pausado boolean, motivo text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c record;
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;

  update contacts set
    pausado = nuevo_pausado,
    motivo_pausa = case when nuevo_pausado then motivo else null end
  where id = target_id
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, 'admin', case when nuevo_pausado then 'pausado' else 'despausado' end,
      case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

-- ---------- 4. Notas libres (empleado, propio) ----------
create or replace function session_set_nota(input_token uuid, target_id uuid, nueva_nota text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set notas = nueva_nota
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'nota', jsonb_build_object('nota', nueva_nota));
  end if;
  return c.id is not null;
end;
$function$;

-- ---------- 5. Crear recordatorio (empleado, propio) ----------
create or replace function session_add_reminder(input_token uuid, target_id uuid, recordar_en timestamptz, nota text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; c record; new_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return null; end if;

  select * into c from contacts where id = target_id and asignado_a = emp.nombre;
  if c.id is null then return null; end if;

  insert into contact_reminders (contact_id, empleado, recordar_en, nota)
  values (target_id, emp.nombre, recordar_en, nota)
  returning id into new_id;

  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  values (c.base_id, c.id, emp.nombre, 'recordatorio_creado', jsonb_build_object('recordar_en', recordar_en, 'nota', nota));

  return new_id;
end;
$function$;

-- ---------- 6. Cola personal de recordatorios vencidos ----------
create or replace function session_list_reminders_pendientes(input_token uuid)
returns table(id uuid, contact_id uuid, nota text, recordar_en timestamptz, contacto_nombre text, contacto_numero text, base_nombre text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select r.id, r.contact_id, r.nota, r.recordar_en, c.nombre, c.numero, d.nombre
  from contact_reminders r
  join contacts c on c.id = r.contact_id
  join databases d on d.id = c.base_id
  where r.empleado = emp.nombre and r.cumplido = false and r.recordar_en <= now()
  order by r.recordar_en asc;
end;
$function$;

-- ---------- 7. Marcar recordatorio atendido ----------
create or replace function session_complete_reminder(input_token uuid, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_updated int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contact_reminders set cumplido = true
  where id = target_id and empleado = emp.nombre;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

-- ---------- 8. Buscador global (nombre o teléfono, todas las bases) ----------
create or replace function admin_search_contacts(input_admin_pin text, query text)
returns table(id uuid, nombre text, numero text, estado text, base_id uuid, base_nombre text, asignado_a text, pausado boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select c.id, c.nombre, c.numero, c.estado, c.base_id, d.nombre, c.asignado_a, c.pausado
  from contacts c
  join databases d on d.id = c.base_id
  where c.nombre ilike '%' || query || '%' or c.numero ilike '%' || query || '%'
  order by c.created_at desc
  limit 200;
end;
$function$;

-- ---------- 9. Importar con detección de duplicados ----------
-- Cambia el tipo de retorno (antes devolvía un solo entero con la cantidad
-- insertada) — hay que actualizar el código cliente que la llama (Parte 6).
-- No auto-detecta duplicados DENTRO del mismo CSV que se está importando,
-- solo contra contactos que ya existían antes en el sistema — así se pidió.
-- Postgres no deja cambiar el tipo de retorno con CREATE OR REPLACE — hay
-- que borrar la versión vieja primero.
drop function if exists admin_import_contacts(text, uuid, jsonb);
create or replace function admin_import_contacts(input_admin_pin text, target_base uuid, rows jsonb)
returns table(insertados int, duplicados int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_insertados int := 0; v_duplicados int := 0;
begin
  if verify_admin_pin(input_admin_pin) is not true then
    return query select 0, 0;
    return;
  end if;

  with candidatos as (
    select
      r->>'nombre' as nombre,
      coalesce(r->>'numero', '') as numero
    from jsonb_array_elements(rows) r
    where coalesce(r->>'nombre', '') <> ''
  ),
  a_insertar as (
    select c.nombre, c.numero
    from candidatos c
    where c.numero = '' or not exists (
      select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
    )
  ),
  hechos as (
    insert into contacts (base_id, nombre, numero, agregado_por)
    select target_base, nombre, numero, 'admin' from a_insertar
    returning id
  )
  select count(*) into v_insertados from hechos;

  select count(*) into v_duplicados
  from candidatos c
  where c.numero <> '' and exists (
    select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
  );

  return query select v_insertados, v_duplicados;
end;
$function$;

-- ---------- 10. session_set_estado — suma ultimo_evento_resumen ----------
create or replace function session_set_estado(input_token uuid, target_id uuid, nuevo_estado text, motivo text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    estado = nuevo_estado, trabajada_por = emp.nombre, fecha_trabajo = current_date,
    ultimo_contacto = current_date, estado_actualizado_at = now(),
    enviado = (nuevo_estado <> 'nuevo'),
    contestado = (nuevo_estado in ('contestado', 'interesado', 'cargado')),
    cargo = (nuevo_estado = 'cargado'),
    motivo_descarte = case when nuevo_estado = 'descartado' then motivo else null end,
    ultimo_evento_resumen = format('%s marcó "%s" el %s', emp.nombre, nuevo_estado, to_char(now(), 'DD/MM HH24:MI')) -- NUEVO
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'estado:' || nuevo_estado, case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

-- ---------- 11. session_claim_urgent — suma ultimo_evento_resumen ----------
create or replace function session_claim_urgent(input_token uuid, target_id uuid, nuevo_estado text, motivo text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    estado = nuevo_estado, trabajada_por = emp.nombre, fecha_trabajo = current_date,
    ultimo_contacto = current_date, estado_actualizado_at = now(), asignado_a = emp.nombre, fecha_asignacion = current_date,
    enviado = (nuevo_estado <> 'nuevo'),
    contestado = (nuevo_estado in ('contestado', 'interesado', 'cargado')),
    cargo = (nuevo_estado = 'cargado'),
    motivo_descarte = case when nuevo_estado = 'descartado' then motivo else null end,
    ultimo_evento_resumen = format('%s tomó un urgente → "%s" el %s', emp.nombre, nuevo_estado, to_char(now(), 'DD/MM HH24:MI')) -- NUEVO
  where id = target_id
    and estado in ('contestado', 'interesado')
    and estado_actualizado_at < now() - interval '2 hours'
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'urgente:' || nuevo_estado, case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

-- ---------- 12. admin_mark_seguimiento — corrige gaps ----------
-- Antes no tocaba estado_actualizado_at ni dejaba registro en contact_events.
create or replace function admin_mark_seguimiento(input_admin_pin text, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c record;
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;

  update contacts set
    estado = 'contactado',
    ultimo_contacto = current_date,
    estado_actualizado_at = now(), -- NUEVO
    ultimo_evento_resumen = format('Admin marcó en seguimiento el %s', to_char(now(), 'DD/MM HH24:MI')) -- NUEVO
  where id = target_id
  returning * into c;

  if c.id is not null then -- NUEVO: antes no dejaba registro
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, 'admin', 'seguimiento', '{}'::jsonb);
  end if;
  return c.id is not null;
end;
$function$;
