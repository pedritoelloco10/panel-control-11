-- ============================================================
-- Blindaje de seguridad — etapa 2: shifts y app_config
-- Correr en Supabase → tu proyecto → SQL Editor → Run.
--
-- Sigue el mismo patrón que ya usan session_set_estado / admin_login (ver
-- session_employee(input_token) y verify_admin_pin(input_pin), que ya
-- existen y esto reutiliza tal cual, sin reinventar nada).
--
-- Qué hace: crea 6 funciones `security definer` para las escrituras que hoy
-- la app hace directo contra `shifts` y `app_config` (autoguardado, abrir y
-- cerrar turno, archivar, excluir del arrastre, cupo de leads), y después
-- cierra la escritura directa a esas dos tablas por API pública — de ahí en
-- más solo se puede escribir a través de estas funciones. La LECTURA queda
-- pública igual que antes (los montos de un turno no son tan sensibles como
-- un PIN, y así no hace falta tocar ninguna de las consultas de lectura que
-- ya tiene la app).
--
-- IMPORTANTE — orden de aplicación: este script crea las funciones nuevas
-- pero temporariamente NO CIERRA todavía el acceso directo a shifts/app_config
-- (esas dos líneas finales quedan comentadas). La idea es que primero
-- pruebes las funciones nuevas a mano (hay ejemplos comentados al final de
-- cada una) y confirmes que andan bien. Recién cuando estés conforme,
-- destapá las dos líneas finales (o avisame y te paso el script de cierre
-- aparte) para cerrar el acceso directo de una vez.
-- ============================================================

-- ---------- Turnos (empleado) ----------

create or replace function session_open_turno(
  input_token uuid,
  nueva_fecha date,
  nueva_hora_inicio time,
  nuevo_turno_label text,
  nuevo_bill_inicio jsonb,
  nuevo_stock_inicio jsonb
)
returns shifts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_result shifts;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    raise exception 'sesión inválida';
  end if;

  insert into shifts (fecha, hora_inicio, responsable, turno_label, bill_inicio, stock_inicio, status)
  values (nueva_fecha, nueva_hora_inicio, emp.nombre, nuevo_turno_label, nuevo_bill_inicio, nuevo_stock_inicio, 'abierto')
  returning * into v_result;

  return v_result;
end;
$function$;
-- Probar: select * from session_open_turno('<un token válido de sessions>'::uuid, current_date, '10:00', 'Mañana', '{}'::jsonb, '{"B":"0","G":"0"}'::jsonb);
-- (después de probar, hay que archivar o cerrar el turno de prueba que crea)

create or replace function session_autosave_turno(
  input_token uuid,
  target_id uuid,
  nuevo_bill_inicio jsonb,
  nuevo_bill_cierre jsonb,
  nuevo_stock_inicio jsonb,
  nuevo_stock_cierre jsonb,
  nuevos_ops jsonb,
  nuevas_bajadas jsonb,
  nuevos_movs jsonb,
  nuevas_notas text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_updated int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  update shifts set
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = nuevos_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas,
    updated_at = now()
  where id = target_id and responsable = emp.nombre and status = 'abierto';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

create or replace function session_close_turno(
  input_token uuid,
  target_id uuid,
  nueva_hora_fin time,
  nuevo_turno_label text,
  nuevo_bill_inicio jsonb,
  nuevo_bill_cierre jsonb,
  nuevo_stock_inicio jsonb,
  nuevo_stock_cierre jsonb,
  nuevos_ops jsonb,
  nuevas_bajadas jsonb,
  nuevos_movs jsonb,
  nuevas_notas text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare emp record; v_updated int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  update shifts set
    status = 'cerrado',
    hora_fin = nueva_hora_fin,
    turno_label = nuevo_turno_label,
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = nuevos_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas,
    updated_at = now(), cerrado_at = now()
  where id = target_id and responsable = emp.nombre and status = 'abierto';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

-- ---------- Turnos (admin) ----------

create or replace function admin_toggle_archivado(input_admin_pin text, target_id uuid, nuevo_archivado boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update shifts set archivado = nuevo_archivado, updated_at = now() where id = target_id;
  return true;
end;
$function$;

create or replace function admin_toggle_excluir_arrastre(input_admin_pin text, target_id uuid, nuevo_excluir boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update shifts set excluir_arrastre = nuevo_excluir, updated_at = now() where id = target_id;
  return true;
end;
$function$;

-- ---------- Configuración (admin) ----------

create or replace function admin_set_config(input_admin_pin text, config_key text, config_value text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update app_config set value = config_value where key = config_key;
  return true;
end;
$function$;

-- ============================================================
-- Recién después de probar las 6 funciones de arriba y de haber actualizado
-- el código de la app para que las use (ver el PR correspondiente), correr
-- estas dos líneas para cerrar la escritura directa:
--
-- drop policy "acceso app" on shifts;
-- create policy "lectura publica" on shifts for select using (true);
--
-- drop policy "acceso app" on app_config;
-- create policy "lectura publica" on app_config for select using (true);
-- ============================================================
