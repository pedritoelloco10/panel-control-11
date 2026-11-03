-- ============================================================
-- Corregir el "stock de inicio" de un turno ya cerrado.
-- Correr en Supabase → SQL Editor → Run.
--
-- Por qué hace falta: el stock de inicio de un turno se fija una sola vez,
-- al abrirlo (se copia del cierre del turno anterior en ese momento). Si
-- después se corrige el saldo real de Ganamos de un turno anterior (por
-- ejemplo al importar), los turnos que ya se habían abierto ANTES de esa
-- corrección se quedan con el número viejo para siempre — no hay forma de
-- arreglarlo desde la pantalla normal. Esto da una vía puntual, solo para
-- Admin, para corregir el arranque de un turno específico a mano.
-- ============================================================

create or replace function admin_corregir_stock_inicio(
  input_admin_pin text, target_id uuid, plataforma text, nuevo_valor text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  if plataforma not in ('B', 'G') then
    return false;
  end if;

  update shifts set
    stock_inicio = jsonb_set(coalesce(stock_inicio, '{}'::jsonb), array[plataforma], to_jsonb(nuevo_valor)),
    updated_at = now()
  where id = target_id;

  return found;
end;
$function$;
