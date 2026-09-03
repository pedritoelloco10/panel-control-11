-- ============================================================
-- CRM de Bases — Parte 1: esquema (columnas y tablas nuevas)
-- Ya corrida en producción (2026-09-03). Solo aditivo — no cambió
-- ningún comportamiento en el momento de aplicarse.
--
-- Verificado antes de correrla: contacts no tiene ningún CHECK
-- constraint sobre `estado` (select conname, pg_get_constraintdef(oid)
-- from pg_constraint where conrelid = 'contacts'::regclass and
-- contype = 'c' — no devolvió filas), así que el nuevo valor
-- 'para_retomar' (usado desde la Parte 2 en adelante) no necesitó
-- ningún cambio de esquema extra.
-- ============================================================

-- ---------- databases ----------
alter table databases add column if not exists activa boolean not null default true;
alter table databases add column if not exists costo numeric not null default 0;

-- ---------- contacts ----------
alter table contacts add column if not exists pausado boolean not null default false;
alter table contacts add column if not exists motivo_pausa text;
alter table contacts add column if not exists notas text;
alter table contacts add column if not exists veces_reciclado int not null default 0;
alter table contacts add column if not exists ultimo_evento_resumen text; -- resumen corto (el historial completo en vivo sigue viviendo en contact_events)

-- ---------- contact_reminders (tabla nueva) ----------
create table if not exists contact_reminders (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  empleado text not null,
  recordar_en timestamptz not null,
  nota text,
  cumplido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists contact_reminders_due_idx on contact_reminders (cumplido, recordar_en);
create index if not exists contact_reminders_contact_idx on contact_reminders (contact_id);

alter table contact_reminders enable row level security;
-- Sin políticas — cerrada del todo, igual que contacts/contact_events.
-- Todo acceso pasa por funciones security definer (Parte 3).

-- ---------- app_config: claves nuevas ----------
insert into app_config (key, value) values
  ('max_reciclados', '3'),
  ('dias_aviso_bajo_rendimiento', '5')
on conflict (key) do nothing;
