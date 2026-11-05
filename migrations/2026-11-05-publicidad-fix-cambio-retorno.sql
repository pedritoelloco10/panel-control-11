-- ============================================================
-- Fix: admin_publicidad_por_turno cambió lo que devuelve (antes solo
-- "cantidad", ahora "mensajes" y "cargas" por separado) y Postgres no
-- deja reemplazar una función cambiándole el tipo de retorno con
-- CREATE OR REPLACE — hay que borrarla primero.
-- Correr en Supabase → SQL Editor → Run.
-- (Si ya corriste 2026-11-05-publicidad-contador-cargas.sql y te dio
-- este error, con esto alcanza — no hace falta volver a correr ese
-- archivo entero, esto ya deja la función final en su lugar.)
-- ============================================================

drop function if exists admin_publicidad_por_turno(text);

create function admin_publicidad_por_turno(input_admin_pin text)
returns table(shift_id uuid, mensajes integer, cargas integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select s.id as shift_id,
    count(pe.id) filter (where pe.tipo = 'mensaje')::int as mensajes,
    count(pe.id) filter (where pe.tipo = 'carga')::int as cargas
  from shifts s
  left join publicidad_eventos pe on pe.shift_id = s.id
  group by s.id;
end;
$function$;
