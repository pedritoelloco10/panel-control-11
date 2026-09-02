-- ============================================================
-- Evitar dos turnos "abierto" en simultáneo
-- Correr en Supabase → tu proyecto → SQL Editor → Run.
--
-- Hoy la app chequea "¿hay alguno abierto?" y recién después inserta uno
-- nuevo — son dos pasos separados, sin nada que lo impida a nivel de base.
-- Dos personas identificándose casi al mismo tiempo podrían, en teoría,
-- terminar abriendo dos cajas a la vez. Este índice lo hace imposible
-- directamente en la base: como mucho un turno "abierto" y no archivado
-- a la vez, para todo el sistema.
--
-- Antes de correrlo: si en este momento ya existiera más de un turno con
-- status='abierto' y archivado=false a la vez (no debería, pero por las
-- dudas), este script va a fallar con un error de "duplicate key" en vez
-- de aplicarse a medias. Si eso pasa: andá a Admin → "Turno abierto" y
-- archivá los que sobren, después volvé a correr este script. No borra ni
-- modifica ningún dato por su cuenta.
-- ============================================================
create unique index if not exists shifts_un_solo_abierto
  on shifts (status)
  where status = 'abierto' and archivado = false;
