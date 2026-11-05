-- ============================================================
-- Auditoría de seguridad — cerrar el borrado libre de "clientes".
-- Correr en Supabase → SQL Editor → Run.
--
-- La tabla clientes tenía una sola política ("acceso app", FOR ALL
-- USING true WITH CHECK true) pensada en su momento solo para la
-- lectura pública (la tabla no tiene datos financieros, solo el
-- identificador del cliente). Pero "FOR ALL" también deja insertar,
-- actualizar y BORRAR sin ningún PIN — con la clave pública (anon key)
-- cualquiera podría vaciar la tabla de clientes entera.
--
-- OperacionesTab.jsx hace exactamente dos cosas con esta tabla:
--   .select("identificador")...   (autocompletar)
--   .upsert({ identificador })... (agregar uno nuevo)
-- Ninguna de las dos necesita DELETE, así que se achica el permiso a
-- lectura + insertar + actualizar, nomás. Nada deja de funcionar.
--
-- NOTA: en producción esto ya estaba resuelto (quedó corregido en algún
-- momento sin que quedara una migración) — schema.sql tenía el nombre
-- viejo de la política ("acceso app") desactualizado. Queda con
-- IF EXISTS / nombres fijos para que sea idempotente: no rompe si se
-- corre sobre la base real (ya sin "acceso app") ni sobre una base
-- nueva creada desde schema.sql (que sí trae "acceso app").
-- ============================================================

drop policy if exists "acceso app" on clientes;
drop policy if exists "clientes select" on clientes;
drop policy if exists "clientes insert" on clientes;
drop policy if exists "clientes update" on clientes;
drop policy if exists "clientes leer" on clientes;
drop policy if exists "clientes insertar" on clientes;
drop policy if exists "clientes actualizar" on clientes;

create policy "clientes leer" on clientes for select using (true);
create policy "clientes insertar" on clientes for insert with check (true);
create policy "clientes actualizar" on clientes for update using (true) with check (true);

-- Chequeo: esta consulta tiene que devolver 3 filas (select, insert, update) y ninguna "delete".
-- select cmd, policyname from pg_policies where tablename = 'clientes';
