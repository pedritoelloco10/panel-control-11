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
  cerrado_at timestamptz,
  archivado boolean not null default false, -- turno oculto de listas/estadísticas (pruebas, errores de carga)
  excluir_arrastre boolean not null default false, -- este cierre no se usa como base del turno siguiente,
    -- pero sigue contando en las estadísticas (a diferencia de archivado)
  error_justificado jsonb not null default '{}', -- { efectivo: bool, B: bool, G: bool } — diferencias de cierre ya revisadas por Admin
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
-- Seguridad: como no usamos login por email (es PIN interno), el acceso de
-- verdad lo dan las funciones admin_*/session_* de más abajo, todas
-- `security definer` (corren con permisos elevados, sin depender de estas
-- políticas). Por eso las tablas que solo se tocan a través de esas
-- funciones quedan CERRADAS del todo a la clave pública (anon): ni lectura
-- ni escritura directa — evita, por ejemplo, poder leer los PIN en texto
-- plano con un simple `select * from employees` desde la consola del
-- navegador. `shifts` sigue abierta por ahora: la app todavía la lee/escribe
-- directo (autoguardado, abrir/cerrar turno) sin pasar por una función; está
-- pendiente de blindar en una segunda etapa que además requiere código nuevo.
-- ============================================================
alter table employees enable row level security;
alter table wallets enable row level security;
alter table shifts enable row level security;
alter table databases enable row level security;
alter table contacts enable row level security;
alter table contact_events enable row level security;
alter table assignments enable row level security;

-- Sin política = todo acceso directo denegado (solo entra por las funciones
-- security definer, que no dependen de RLS).
-- employees, contacts, contact_events, assignments: sin políticas.

-- wallets y databases: la app SÍ las lee directo desde el cliente (nombres
-- de billeteras, lista de bases), pero toda escritura ya pasa por funciones
-- (admin_add_wallet, admin_rename_wallet, admin_create_base, etc.) — se deja
-- lectura pública nomás.
create policy "lectura publica" on wallets for select using (true);
create policy "lectura publica" on databases for select using (true);

-- shifts: sin blindar todavía (ver comentario arriba).
create policy "acceso app" on shifts for all using (true) with check (true);

-- ---------- Datos iniciales ----------
insert into employees (nombre, pin) values
  ('J', '1111'), ('B', '2222'), ('E', '3333'), ('O', '4444'), ('A', '5555');

insert into wallets (nombre, orden) values
  ('Dolapp',1),('Naranja X',2),('Mercado Pago',3),('Uala',4),('Prex',5),('Brubank',6),
  ('Personal Pay',7),('Lemon',8),('Reba',9),('MODO',10),('Cuenta DNI',11),('Belo',12),
  ('Ripio',13),('Astropay',14),('BNA+',15),('Openbank',16);
