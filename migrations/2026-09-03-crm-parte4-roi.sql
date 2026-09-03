-- ============================================================
-- CRM de Bases — Parte 4: vínculo con Operaciones (ROI)
-- Correr en Supabase → SQL Editor → Run.
-- Requiere que las Partes 1-3 ya estén corridas.
--
-- Qué hace: reemplaza session_autosave_turno y session_close_turno (las
-- mismas dos funciones del incidente de hoy — se tocan con el mismo
-- cuidado) para que, antes de guardar las operaciones del turno, resuelvan
-- el vínculo de cada venta con origen "lista" (L) contra Bases:
--
--   Para cada operación con origen='lista' que todavía no tenga resuelto
--   un contacto de origen, busca el contacto en estado 'cargado' más
--   reciente cuyo `numero` termine en lo que se cargó en el campo
--   "Cliente" de esa operación, y le graba `origen_base_id` /
--   `origen_contact_id` a ESA operación puntual dentro del JSON.
--
-- Tal como se pidió: no es 100% infalible (puede haber colisión de los
-- últimos dígitos entre contactos de bases distintas) — se prioriza el
-- contacto marcado "cargado" más recientemente en caso de ambigüedad, a
-- propósito.
--
-- El resto de las dos funciones (validación de propiedad del turno,
-- candados) queda exactamente igual — lo único nuevo es el cálculo de
-- `v_ops` antes del UPDATE, marcado con NUEVO abajo.
--
-- Riesgo: cambio inmediato para todo el equipo, como con cualquier
-- reemplazo de estas dos funciones. Para operaciones que NO son origen
-- "lista", o que no tienen ningún contacto "cargado" coincidente, el
-- comportamiento es idéntico al de hoy — la operación se guarda tal cual
-- viene, sin ningún campo extra.
-- ============================================================

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
declare emp record; v_updated int; v_ops jsonb;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  -- NUEVO: vínculo con Bases para operaciones origen "lista".
  select coalesce(jsonb_agg(
    case
      when (elem->>'origen') = 'lista'
        and (elem->>'origen_base_id') is null
        and coalesce(elem->>'cliente', '') <> ''
      then elem || coalesce(
        (select jsonb_build_object('origen_base_id', c.base_id, 'origen_contact_id', c.id)
         from contacts c
         where c.estado = 'cargado' and c.numero <> ''
           and c.numero like '%' || (elem->>'cliente')
         order by c.estado_actualizado_at desc nulls last
         limit 1),
        '{}'::jsonb
      )
      else elem
    end
  ), '[]'::jsonb)
  into v_ops
  from jsonb_array_elements(nuevos_ops) elem;

  update shifts set
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = v_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas, -- ops = v_ops (antes nuevos_ops directo)
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
declare emp record; v_updated int; v_ops jsonb;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  -- NUEVO: mismo vínculo que en session_autosave_turno, se corre también al
  -- cerrar por si se cargó alguna operación en los segundos justo antes de
  -- cerrar, después del último autoguardado.
  select coalesce(jsonb_agg(
    case
      when (elem->>'origen') = 'lista'
        and (elem->>'origen_base_id') is null
        and coalesce(elem->>'cliente', '') <> ''
      then elem || coalesce(
        (select jsonb_build_object('origen_base_id', c.base_id, 'origen_contact_id', c.id)
         from contacts c
         where c.estado = 'cargado' and c.numero <> ''
           and c.numero like '%' || (elem->>'cliente')
         order by c.estado_actualizado_at desc nulls last
         limit 1),
        '{}'::jsonb
      )
      else elem
    end
  ), '[]'::jsonb)
  into v_ops
  from jsonb_array_elements(nuevos_ops) elem;

  update shifts set
    status = 'cerrado',
    hora_fin = nueva_hora_fin,
    turno_label = nuevo_turno_label,
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = v_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas, -- ops = v_ops (antes nuevos_ops directo)
    updated_at = now(), cerrado_at = now()
  where id = target_id and responsable = emp.nombre and status = 'abierto';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;
