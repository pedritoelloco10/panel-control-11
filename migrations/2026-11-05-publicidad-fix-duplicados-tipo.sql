-- ============================================================
-- Fix: las funciones de publicidad quedaron duplicadas cuando se les
-- agregó el parámetro p_tipo (CREATE OR REPLACE no reemplaza una función
-- si le cambia la cantidad de parámetros — crea una versión nueva al
-- lado de la vieja, en vez de reemplazarla). Esto rompía "Mensajes de
-- publicidad" en la pantalla del empleado con "No se pudo actualizar".
-- Mismo tipo de bug que ya se corrigió para admin_importar_ganamos_operaciones
-- y admin_publicidad_por_turno — acá faltaba corregirlo para estas 4.
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================

drop function if exists session_add_publicidad_evento(uuid);
drop function if exists session_remove_publicidad_evento(uuid);
drop function if exists session_count_publicidad_hoy(uuid);
drop function if exists admin_count_publicidad(text, date, date);

-- Chequeo: cada una de estas 4 consultas tiene que devolver UNA sola fila.
-- select proname, pronargs from pg_proc where proname = 'session_add_publicidad_evento';
-- select proname, pronargs from pg_proc where proname = 'session_remove_publicidad_evento';
-- select proname, pronargs from pg_proc where proname = 'session_count_publicidad_hoy';
-- select proname, pronargs from pg_proc where proname = 'admin_count_publicidad';
