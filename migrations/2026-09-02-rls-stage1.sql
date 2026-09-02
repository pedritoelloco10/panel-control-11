-- ============================================================
-- Blindaje de seguridad — etapa 1
-- Correr una sola vez en Supabase → tu proyecto → SQL Editor → Run.
-- Verificado antes de escribir esto: todas las funciones admin_*/session_*
-- que la app usa son `security definer` (prosecdef = true), así que siguen
-- funcionando igual sin importar estas políticas — no dependen de RLS.
--
-- Qué hace: cierra el acceso directo por API pública (clave "anon") a las
-- tablas que la app nunca toca directo desde el cliente — todo pasa por esas
-- funciones. Antes de esto, cualquiera con la URL y la clave anon (visibles
-- en el código del navegador) podía hacer, por ejemplo,
-- `supabase.from("employees").select("*")` y leer todos los PIN en texto
-- plano sin loguearse en ningún lado.
--
-- No requiere pausar nada ni avisar a nadie: la app no usa acceso directo a
-- estas tablas en ningún punto del código, así que no hay nada que se pueda
-- romper. `shifts` queda para una segunda etapa aparte (sí la toca la app
-- directo — autoguardado, abrir/cerrar turno — así que blindarla requiere
-- funciones nuevas y cambios de código, no solo este script).
-- ============================================================

-- employees, contacts, contact_events, assignments: cierre total.
-- Sin ninguna política = con RLS habilitado, todo acceso directo (anon
-- y authenticated) queda denegado. Solo entran las funciones security
-- definer, que no pasan por RLS.
drop policy if exists "acceso app" on employees;
drop policy if exists "acceso app" on contacts;
drop policy if exists "acceso app" on contact_events;
drop policy if exists "acceso app" on assignments;

-- wallets y databases: la app SÍ las lee directo desde el cliente (nombres
-- de billeteras en el turno, lista de bases en Admin), pero todas las
-- escrituras ya van por funciones (admin_add_wallet, admin_rename_wallet,
-- admin_delete_wallet, admin_create_base, admin_delete_base, etc.).
-- Se deja lectura pública, se cierra la escritura directa.
drop policy if exists "acceso app" on wallets;
create policy "lectura publica" on wallets for select using (true);

drop policy if exists "acceso app" on databases;
create policy "lectura publica" on databases for select using (true);

-- shifts: sin cambios en esta etapa — sigue con "acceso app" (abierta),
-- porque la app la usa directo desde el cliente. Queda para la etapa 2.
