-- ============================================================
-- Importación de Ganamos repartida por horario real, no por "un turno
-- puntual". Correr en Supabase → SQL Editor → Run.
--
-- El supuesto de "3 turnos fijos de 8hs por día" no coincide con cómo
-- laburan de verdad — un mismo día puede tener varios turnos cortos,
-- cerrados antes de tiempo a pedido, o por error del empleado. Con
-- ganamos_import_resolver_turno (que busca UN turno por fecha+hora de
-- inicio aproximada) esas operaciones se podían repartir mal.
--
-- Esta función nueva recibe TODAS las operaciones leídas de Ganamos de
-- una franja (cada una con su hora exacta) y las reparte ella sola,
-- adentro, al turno cerrado cuyo horario inicio→cierre contiene esa
-- hora — igual que ya hace "Importar Ganamos" cuando se carga a mano.
-- El código limitado NUNCA ve la lista de turnos ni sus datos: solo
-- le llega de vuelta un resumen (cuántos turnos se tocaron, cuántas
-- operaciones se agregaron, y los TX que no encontraron turno).
-- ============================================================

create or replace function admin_importar_ganamos_por_horario(
  input_token text, operaciones jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_via_admin boolean;
  v_origen text;
  v_lote text := extract(epoch from clock_timestamp())::text;
  v_op jsonb;
  v_shift_id uuid;
  v_fecha_hora timestamp;
  v_tx_existentes_global text[];
  v_turnos_tocados int := 0;
  v_total_agregadas int := 0;
  r record;
begin
  v_via_admin := verify_admin_pin(input_token);
  if not (v_via_admin or verify_ganamos_import_token(input_token)) then
    return null;
  end if;
  v_origen := case when v_via_admin then 'admin' else 'auto' end;

  create temporary table tmp_ops_por_turno (shift_id uuid, op jsonb) on commit drop;
  create temporary table tmp_sin_turno (tx text) on commit drop;
  create temporary table tmp_ya_existe (tx text) on commit drop;

  -- Chequeo GLOBAL de duplicados: un ganamos_tx que ya esté en CUALQUIER turno
  -- (no solo el que le toque por horario) no se vuelve a insertar en ningún
  -- lado. Esto evita que un límite de horario ajustado (un cierre real un
  -- poco después de lo esperado) termine metiendo la misma operación en dos
  -- turnos distintos si se reimporta.
  select coalesce(array_agg(distinct elem->>'ganamos_tx'), '{}')
    into v_tx_existentes_global
    from shifts s2, jsonb_array_elements(s2.ops) as elem
    where elem->>'ganamos_tx' is not null;

  for v_op in select * from jsonb_array_elements(operaciones)
  loop
    v_fecha_hora := (v_op->>'fecha_hora')::timestamp;
    v_shift_id := null;

    select s.id into v_shift_id
    from shifts s
    where s.status = 'cerrado' and s.archivado = false
      and s.fecha between (v_fecha_hora::date - 1) and v_fecha_hora::date
      and v_fecha_hora >= (s.fecha + s.hora_inicio)
      and v_fecha_hora < (s.fecha + s.hora_fin + (case when s.hora_fin <= s.hora_inicio then interval '1 day' else interval '0 minutes' end))
    order by s.cerrado_at desc nulls last
    limit 1;

    if v_op->>'ganamos_tx' is not null and v_op->>'ganamos_tx' = any(v_tx_existentes_global) then
      insert into tmp_ya_existe (tx) values (v_op->>'ganamos_tx');
    elsif v_shift_id is null then
      insert into tmp_sin_turno (tx) values (v_op->>'ganamos_tx');
    else
      insert into tmp_ops_por_turno (shift_id, op) values (v_shift_id, v_op);
    end if;
  end loop;

  for r in select shift_id, jsonb_agg(op) as ops_crudas from tmp_ops_por_turno group by shift_id
  loop
    declare
      v_ops_actuales jsonb;
      v_tx_existentes text[];
      v_ops_filtradas jsonb;
      v_creado_at timestamptz;
      v_siguiente_id uuid;
      v_saldo text;
      v_agregadas int;
    begin
      select ops, created_at into v_ops_actuales, v_creado_at from shifts where id = r.shift_id for update;

      select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
        into v_tx_existentes
        from jsonb_array_elements(v_ops_actuales) as elem
        where elem->>'ganamos_tx' is not null;

      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'tipo', elem->>'tipo', 'plataforma', coalesce(elem->>'plataforma', 'G'),
                 'monto', elem->>'monto', 'bono', coalesce(elem->>'bono', '0'),
                 'cliente', elem->>'cliente', 'usuario', elem->>'usuario',
                 'origen', null, 'ganamos_tx', elem->>'ganamos_tx',
                 '_lote', v_lote, '_lote_origen', v_origen
               )
             ), '[]'::jsonb)
        into v_ops_filtradas
        from jsonb_array_elements(r.ops_crudas) as elem
        where elem->>'ganamos_tx' is null or not (elem->>'ganamos_tx' = any(v_tx_existentes));

      select elem->>'saldo_despues' into v_saldo
        from jsonb_array_elements(r.ops_crudas) as elem
        where elem->>'saldo_despues' is not null
        order by (elem->>'fecha_hora')::timestamp desc
        limit 1;

      update shifts set
        ops = v_ops_actuales || v_ops_filtradas,
        stock_cierre = case
          when v_saldo is not null then
            jsonb_set(jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(v_saldo)), '{G_real}', 'true'::jsonb)
          else stock_cierre
        end,
        updated_at = now()
      where id = r.shift_id;

      if v_saldo is not null then
        select id into v_siguiente_id from shifts
          where archivado = false and created_at > v_creado_at
          order by created_at asc limit 1;
        if v_siguiente_id is not null then
          update shifts set
            stock_inicio = jsonb_set(coalesce(stock_inicio, '{}'::jsonb), '{G}', to_jsonb(v_saldo)),
            updated_at = now()
          where id = v_siguiente_id;
        end if;
      end if;

      select count(*) into v_agregadas from jsonb_array_elements(v_ops_filtradas);
      v_total_agregadas := v_total_agregadas + v_agregadas;
      v_turnos_tocados := v_turnos_tocados + 1;
    end;
  end loop;

  return jsonb_build_object(
    'turnos_tocados', v_turnos_tocados,
    'operaciones_agregadas', v_total_agregadas,
    'sin_turno', (select coalesce(jsonb_agg(tx), '[]'::jsonb) from tmp_sin_turno),
    'ya_existia', (select coalesce(jsonb_agg(tx), '[]'::jsonb) from tmp_ya_existe)
  );
end;
$function$;
