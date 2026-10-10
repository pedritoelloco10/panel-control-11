-- ============================================================
-- Auditoría de seguridad — Paso 5: limpiar política SELECT duplicada en
-- wallets.
-- Correr en Supabase → SQL Editor → Run.
--
-- wallets tenía dos políticas de lectura pública con el mismo efecto
-- ("wallets select" y "lectura publica", ambas `using (true)`) —
-- probablemente de una corrida duplicada en su momento. Inofensivo, pero
-- se deja una sola para que quede prolijo. wallets sigue siendo de
-- lectura pública a propósito (nombres de billeteras, se necesitan antes
-- de loguearse) — esto no cambia esa decisión, solo saca la redundancia.
-- ============================================================

drop policy "lectura publica" on wallets;
