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
-- ============================================================

drop policy "acceso app" on clientes;

create policy "clientes leer" on clientes for select using (true);
create policy "clientes insertar" on clientes for insert with check (true);
create policy "clientes actualizar" on clientes for update using (true) with check (true);

-- Chequeo: esta consulta tiene que devolver 3 filas (select, insert, update) y ninguna "delete".
-- select cmd, policyname from pg_policies where tablename = 'clientes';
