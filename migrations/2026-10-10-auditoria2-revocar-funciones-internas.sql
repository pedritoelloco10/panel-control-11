-- ============================================================
-- Auditoría ampliada — cerrar 2 funciones internas sin chequeo de auth
-- a la llamada directa por API pública.
-- Correr en Supabase → SQL Editor → Run.
--
-- is_refuerzo_now(nombre_empleado) y empleado_pin_en_uso(check_pin) no
-- piden token ni PIN — están pensadas para usarse SOLO desde adentro de
-- otras funciones security definer (que sí validan). Como PostgREST
-- expone por default cualquier función del schema public como endpoint
-- RPC, hoy cualquiera con la clave anónima las puede llamar directo:
--   - is_refuerzo_now: revela si hay un turno abierto y de quién no es
--     (se podría usar para deducir quién está trabajando ahora mismo).
--   - empleado_pin_en_uso: revela si un PIN de 4 dígitos ya está en uso
--     por algún empleado (sin decir cuál).
--
-- Nada de esto es gravísimo, pero no hace falta que sea público. La
-- lógica de las funciones NO cambia — solo se les saca el permiso de
-- ejecución directa a los roles públicos (anon/authenticated). Las
-- funciones que SÍ las llaman desde adentro (admin_add_employee,
-- admin_update_employee, y lo que use is_refuerzo_now) siguen
-- funcionando exactamente igual, porque corren como security definer
-- con los permisos del dueño, no con los del rol que las invocó.
-- ============================================================

revoke execute on function is_refuerzo_now(text) from anon, authenticated;
revoke execute on function empleado_pin_en_uso(text, uuid) from anon, authenticated;
