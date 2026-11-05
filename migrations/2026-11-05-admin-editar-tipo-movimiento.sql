-- ============================================================
-- Admin: poder corregir el "tipo" (Compra / Recupero de bono) de un
-- movimiento de fichas ya cargado, aunque el turno esté cerrado.
-- Correr en Supabase → SQL Editor → Run.
--
-- Hoy no hay ninguna forma de editar un "mov" (Compra de fichas /
-- Recupero de bono) después de que el turno cierra — y como Compra y
-- Recupero de bono ahora afectan cosas distintas (fichas vs. efectivo),
-- hace falta poder corregir uno que se cargó con el tipo equivocado,
-- sin tener que deshacer ni reimportar nada de Ganamos (son cosas
-- separadas: los movs no los toca la importación).
--
-- Identifica el movimiento por su posición en el array (mov_index,
-- empezando en 0 — el mismo orden en que se ve en "Movimientos" del
-- turno) en vez de un id, porque los movs viejos no siempre tienen uno.
-- ============================================================

create or replace function admin_editar_tipo_movimiento(
  input_admin_pin text, target_shift_id uuid, mov_index int, nuevo_tipo text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_movs jsonb;
begin
  if not verify_admin_pin(input_admin_pin) then return false; end if;

  select movs into v_movs from shifts where id = target_shift_id;
  if v_movs is null or mov_index < 0 or mov_index >= jsonb_array_length(v_movs) then return false; end if;

  update shifts set
    movs = jsonb_set(v_movs, array[mov_index::text, 'tipo'], to_jsonb(nuevo_tipo)),
    updated_at = now()
  where id = target_shift_id;

  return true;
end;
$function$;
