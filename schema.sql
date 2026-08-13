-- ============================================================
-- Esquema de la base para el panel de control de Diego
-- Pegar entero en Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Empleados (PIN de acceso) ----------
create table employees (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  pin text not null unique,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Billeteras configuradas ----------
create table wallets (
  id serial primary key,
  nombre text not null unique,
  orden int not null default 0
);

-- ---------- Turnos (uno abierto en vivo, el resto históricos) ----------
create table shifts (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time,
  responsable text not null,
  turno_label text,
  bill_inicio jsonb not null default '{}',
  bill_cierre jsonb not null default '{}',
  stock_inicio jsonb not null default '{}',
  stock_cierre jsonb not null default '{}',
  ops jsonb not null default '[]',
  bajadas jsonb not null default '[]',
  movs jsonb not null default '[]',
  notas text default '',
  mensajes_enviados int not null default 0,
  status text not null default 'abierto', -- 'abierto' | 'cerrado'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shifts_status_idx on shifts (status);
create index shifts_fecha_idx on shifts (fecha);

-- ---------- Bases de datos de clientes ----------
create table databases (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'comprada', -- general | reactivacion | comprada
  quota_empleado int, -- si no es null, el empleado puede agregar hasta esta cantidad de contactos
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null references databases(id) on delete cascade,
  nombre text not null,
  numero text default '',
  enviado boolean not null default false,
  contestado boolean not null default false,
  cargo boolean not null default false,
  agregado_por text, -- 'admin' o nombre de empleado
  trabajada_por text,
  fecha_trabajo date,
  created_at timestamptz not null default now()
);
create index contacts_base_idx on contacts (base_id);

-- Respaldo permanente: historial de todo lo que pasa en cada base, no se borra nunca.
create table contact_events (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null,
  contact_id uuid,
  empleado text,
  accion text not null, -- creado | enviado | contestado | cargo | eliminado
  detalle jsonb default '{}',
  created_at timestamptz not null default now()
);
create index contact_events_base_idx on contact_events (base_id);

-- ---------- Asignación de bases a empleados por día ----------
create table assignments (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid references employees(id),
  empleado_nombre text not null,
  base_id uuid references databases(id),
  base_nombre text not null,
  fecha date not null,
  quota int, -- cuántos contactos puede cargar el empleado ese día en esa base
  created_at timestamptz not null default now()
);
create index assignments_fecha_idx on assignments (fecha);

-- ============================================================
-- Seguridad: como no usamos login por email (es PIN interno),
-- dejamos la API abierta a la clave pública (anon) pero SOLO
-- estas tablas y sin exponer nada del resto del proyecto.
-- Esto es apropiado para una herramienta interna chica; si más
-- adelante querés reforzarlo, se puede migrar a Supabase Auth.
-- ============================================================
alter table employees enable row level security;
alter table wallets enable row level security;
alter table shifts enable row level security;
alter table databases enable row level security;
alter table contacts enable row level security;
alter table contact_events enable row level security;
alter table assignments enable row level security;

create policy "acceso app" on employees for all using (true) with check (true);
create policy "acceso app" on wallets for all using (true) with check (true);
create policy "acceso app" on shifts for all using (true) with check (true);
create policy "acceso app" on databases for all using (true) with check (true);
create policy "acceso app" on contacts for all using (true) with check (true);
create policy "acceso app" on contact_events for all using (true) with check (true);
create policy "acceso app" on assignments for all using (true) with check (true);

-- ---------- Datos iniciales ----------
insert into employees (nombre, pin) values
  ('J', '1111'), ('B', '2222'), ('E', '3333'), ('O', '4444'), ('A', '5555');

insert into wallets (nombre, orden) values
  ('Dolapp',1),('Naranja X',2),('Mercado Pago',3),('Uala',4),('Prex',5),('Brubank',6),
  ('Personal Pay',7),('Lemon',8),('Reba',9),('MODO',10),('Cuenta DNI',11),('Belo',12),
  ('Ripio',13),('Astropay',14),('BNA+',15),('Openbank',16);
