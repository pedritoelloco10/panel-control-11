-- ============================================================
-- Esquema de la base para el panel de control de Diego
-- Pegar entero en Supabase → SQL Editor → New query → Run
--
-- Nota: las columnas/tablas agregadas después del bootstrap original
-- (recibe_leads, estado/motivo_descarte/ultimo_contacto/asignado_a/
-- fecha_asignacion en contacts, app_config, clientes) se reconstruyeron
-- leyendo cómo las usa el código de la app — no se verificaron tipo por
-- tipo contra la base real de producción (no hay forma de inspeccionarla
-- desde este entorno). Sirven para levantar un proyecto nuevo desde cero;
-- si eso llega a pasar, revisá tipos y defaults contra lo que espere el
-- resto del código antes de confiar en esto a ciegas.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Empleados (PIN de acceso) ----------
create table employees (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  pin text not null unique,
  activo boolean not null default true,
  recibe_leads boolean not null default true, -- si no, no participa del reparto automático de leads
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
-- A lo sumo un turno "abierto" y no archivado a la vez en todo el sistema —
-- evita que una carrera (dos personas identificándose casi juntas) termine
-- abriendo dos cajas al mismo tiempo.
create unique index shifts_un_solo_abierto on shifts (status) where status = 'abierto' and archivado = false;

-- ---------- Bases de datos de clientes ----------
create table databases (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- `tipo` quedó vestigial: admin_create_base siempre inserta 'comprada' acá
  -- sin importar la fuente real — no lo uses para mostrar nada, la fuente
  -- real de cada base está en `tipo_fuente` (ver FUENTE_TYPES en lib.js).
  tipo text not null default 'comprada',
  tipo_fuente text not null default 'masiva', -- masiva | principales | comprada, ver FUENTE_TYPES
  -- Si está en true, session_get_leads reparte los leads de esta base antes
  -- que los de las demás de su misma franja de calidad (ver migrations/).
  prioridad boolean not null default false,
  quota_empleado int, -- sin uso — resabio de un reparto manual anterior al automático (session_get_leads)
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
  -- Estado del lead (nuevo/contactado/contestado/interesado/cargado/descartado,
  -- ver LEAD_STATES en lib.js) y su asignación diaria por el reparto automático
  -- (session_get_leads, security definer — ver comentario más abajo).
  estado text not null default 'nuevo',
  motivo_descarte text,
  ultimo_contacto date,
  asignado_a text, -- nombre de empleado, igual que trabajada_por/agregado_por
  fecha_asignacion date,
  estado_actualizado_at timestamptz, -- cuándo cambió `estado` por última vez (para la cola de urgentes y el reciclado)
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
-- Sin uso — resabio del reparto manual anterior al automático (session_get_leads
-- ya lo reemplazó del todo). Se deja documentada por si alguien la encuentra en
-- Supabase y no sabe si puede borrarla; no la toca ningún código de la app.
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

-- ---------- Configuración general (clave/valor) ----------
-- Todas leídas por session_get_leads/session_my_status (security definer) al
-- repartir leads. Los valores por defecto de acá son los que usan esas
-- funciones si la fila no existe — se documentan con el valor real vigente.
create table app_config (
  key text primary key,
  value text
);
insert into app_config (key, value) values
  ('cupo_diario_leads', '35'),        -- leads activos simultáneos por empleado (no es un tope total del día: se liberan lugares a medida que resuelve)
  ('cupo_refuerzo_leads', '20'),      -- ídem, pero para alguien trabajando como refuerzo
  ('porcentaje_relleno', '15'),       -- % del cupo que se llena primero con leads de fuente "masiva"
  ('dias_reciclar_contactado', '3'),  -- días sin avance en estado "contactado" antes de volver al pool
  ('horas_reciclar_contestado', '24'); -- horas sin avance en "contestado"/"interesado" antes de volver al pool

-- ---------- Identificadores de cliente ya vistos (autocompletar en Operaciones) ----------
create table clientes (
  identificador text primary key,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Seguridad: como no usamos login por email (es PIN interno), el acceso de
-- verdad lo dan las funciones admin_*/session_* de más abajo, todas
-- `security definer` (corren con permisos elevados, sin depender de estas
-- políticas). Por eso las tablas que solo se tocan a través de esas
-- funciones quedan CERRADAS del todo a la clave pública (anon): ni lectura
-- ni escritura directa — evita, por ejemplo, poder leer los PIN en texto
-- plano con un simple `select * from employees` desde la consola del
-- navegador.
-- ============================================================
alter table employees enable row level security;
alter table wallets enable row level security;
alter table shifts enable row level security;
alter table databases enable row level security;
alter table contacts enable row level security;
alter table contact_events enable row level security;
alter table assignments enable row level security;
alter table app_config enable row level security;
alter table clientes enable row level security;

-- Sin política = todo acceso directo denegado (solo entra por las funciones
-- security definer, que no dependen de RLS).
-- employees, contacts, contact_events, assignments: sin políticas.

-- wallets y databases: la app SÍ las lee directo desde el cliente (nombres
-- de billeteras, lista de bases), pero toda escritura ya pasa por funciones
-- (admin_add_wallet, admin_rename_wallet, admin_create_base, etc.) — se deja
-- lectura pública nomás.
create policy "lectura publica" on wallets for select using (true);
create policy "lectura publica" on databases for select using (true);

-- shifts y app_config: mismo trato que wallets/databases — lectura pública,
-- escritura solo a través de funciones (session_open_turno,
-- session_autosave_turno, session_close_turno, admin_toggle_archivado,
-- admin_toggle_excluir_arrastre, admin_set_config).
create policy "lectura publica" on shifts for select using (true);
create policy "lectura publica" on app_config for select using (true);

-- clientes: identificadores para autocompletar en Operaciones, sin datos
-- sensibles — se deja abierta, cualquier empleado logueado la usa directo.
create policy "acceso app" on clientes for all using (true) with check (true);

-- ---------- Datos iniciales ----------
insert into employees (nombre, pin) values
  ('J', '1111'), ('B', '2222'), ('E', '3333'), ('O', '4444'), ('A', '5555');

insert into wallets (nombre, orden) values
  ('Dolapp',1),('Naranja X',2),('Mercado Pago',3),('Uala',4),('Prex',5),('Brubank',6),
  ('Personal Pay',7),('Lemon',8),('Reba',9),('MODO',10),('Cuenta DNI',11),('Belo',12),
  ('Ripio',13),('Astropay',14),('BNA+',15),('Openbank',16);
