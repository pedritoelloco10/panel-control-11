-- ============================================================
-- Bono recuperado atado al retiro puntual que lo generó, en vez de un
-- "movimiento" suelto sin cliente ni operación asociada.
-- Correr en Supabase → SQL Editor → Run.
--
-- El problema de fondo: Ganamos solo sabe el monto TOTAL de fichas que
-- se retiran — no tiene forma de saber que una parte de ese retiro es
-- un bono no retirable que la agencia recupera (no paga en efectivo).
-- Por eso cada retiro con bono recuperado tenía que compensarse a mano
-- con un "Recupero de bono" en Movimientos — tedioso y fácil de
-- olvidar en operaciones que no sean la última del lote.
--
-- Ahora cada operación de retiro puede tener su propio campo "bono"
-- (el mismo campo que ya usan las cargas, reusado) = cuánto de ESE
-- retiro puntual fue recuperado como bono, no pagado en efectivo. Se
-- edita directo desde "Hoja de operaciones" en el detalle de cada
-- turno. Esto NO reemplaza "Recupero de bono" en Movimientos (sigue
-- sirviendo para casos sueltos que no vienen de un retiro puntual) —
-- son dos herramientas para el mismo concepto, usá la que corresponda.
--
-- Efecto en los cálculos (ver AdminDashboard.jsx computeShift y
-- useTurnoDraft.js): el bono de un retiro resta del efectivo esperado
-- (esa plata no salió de la caja) pero NO de las fichas esperadas (el
-- retiro completo ya las devuelve bien, tal cual viene de Ganamos).
-- ============================================================

create or replace function admin_editar_bono_operacion(
  input_admin_pin text, target_shift_id uuid, op_index int, nuevo_bono text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ops jsonb;
begin
  if not verify_admin_pin(input_admin_pin) then return false; end if;

  select ops into v_ops from shifts where id = target_shift_id;
  if v_ops is null or op_index < 0 or op_index >= jsonb_array_length(v_ops) then return false; end if;

  update shifts set
    ops = jsonb_set(v_ops, array[op_index::text, 'bono'], to_jsonb(nuevo_bono)),
    updated_at = now()
  where id = target_shift_id;

  return true;
end;
$function$;
