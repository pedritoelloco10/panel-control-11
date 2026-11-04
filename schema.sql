-- ============================================================
-- Esquema completo del panel de control — reconciliado el 2026-11-04
-- contra el estado REAL de la base de producción (no solo contra las
-- migraciones versionadas). Pegar entero en un proyecto Supabase nuevo
-- → SQL Editor → Run, para levantar una base funcionalmente idéntica.
--
-- Cómo se armó: se partió del schema.sql anterior (bootstrap original +
-- reconstrucciones previas) y se lo cruzó línea por línea contra las ~45
-- migraciones en migrations/*.sql Y contra un volcado real de
-- `pg_get_functiondef()` de TODAS las funciones que existen hoy en la
-- base de producción. Donde migraciones y funciones reales no
-- coincidían, ganó siempre la función real (es lo que corre hoy).
--
-- *** LEER LA SECCIÓN "NOTAS Y DRIFT DETECTADO" AL FINAL DE ESTE ARCHIVO
-- ANTES DE CONFIAR EN ESTE ESQUEMA A CIEGAS *** — hay 4 tablas que nunca
-- quedaron documentadas en ninguna migración (se crearon directo en
-- Supabase en algún momento) y se reconstruyeron por inferencia leyendo
-- cómo las usan las funciones reales, sin poder verificar tipos/defaults
-- exactos contra la base real. Y hay un bug de funciones duplicadas que
-- sigue activo en producción ahora mismo, sin arreglar del todo.
-- ============================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ============================================================
-- TABLAS
-- ============================================================

-- ---------- Empleados (PIN de acceso, hasheado con bcrypt) ----------
create table employees (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  pin_hash text not null, -- bcrypt vía extensions.crypt()/extensions.gen_salt('bf') — la columna vieja "pin" en texto plano se borró del todo (auditoría paso 4B)
  activo boolean not null default true,
  recibe_leads boolean not null default true, -- si no, no participa del reparto automático de leads
  cupo_leads int, -- cupo diario personalizado; si es null, usa app_config.cupo_diario_leads
  created_at timestamptz not null default now()
);

-- ---------- Sesiones de empleado (token emitido al loguearse con el PIN) ----------
-- INFERIDA — nunca tuvo una migración con su CREATE TABLE; reconstruida leyendo
-- cómo la usan session_employee / verify_employee_pin / session_end_login /
-- session_valid / admin_active_sessions. El tiempo de expiración exacto
-- (acá puesto en 12 horas) no está confirmado contra la base real — ajustar
-- si hace falta.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references employees(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);
create index sessions_token_idx on sessions (token);
create index sessions_empleado_idx on sessions (empleado_id);

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
  -- stock_inicio / stock_cierre: { "B": "...", "G": "...", "G_reportado": "...", "G_real": true }
  -- G_reportado: lo que el empleado anotó que vio en Ganamos al cerrar (referencia, sin verificar).
  -- G_real: true cuando el saldo de G en stock_cierre viene de una importación real de Ganamos
  -- (admin_importar_ganamos_operaciones con nuevo_saldo_gana) — ver carriedStock en useTurnoDraft.js.
  stock_inicio jsonb not null default '{}',
  stock_cierre jsonb not null default '{}',
  -- ops: [{ tipo, plataforma, monto, bono, cliente, origen, hora, fuente,
  --         ganamos_tx, _lote, origen_base_id, origen_contact_id }, ...]
  ops jsonb not null default '[]',
  bajadas jsonb not null default '[]',
  movs jsonb not null default '[]',
  notas text default '',
  mensajes_enviados int not null default 0, -- sin uso activo hoy (publicidad_eventos lo reemplazó) — se deja por compatibilidad
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
create index shifts_created_at_idx on shifts (created_at); -- usado por la propagación de saldo real de Ganamos al turno siguiente
-- A lo sumo un turno "abierto" y no archivado a la vez en todo el sistema —
-- evita que una carrera (dos personas identificándose casi juntas) termine
-- abriendo dos cajas al mismo tiempo.
create unique index shifts_un_solo_abierto on shifts (status) where status = 'abierto' and archivado = false;

-- ---------- Bases de datos de clientes (CRM / Bases) ----------
create table databases (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- `tipo` quedó vestigial: admin_create_base siempre inserta 'comprada' acá
  -- sin importar la fuente real — no lo uses para mostrar nada, la fuente
  -- real de cada base está en `tipo_fuente` (ver FUENTE_TYPES en lib.js).
  tipo text not null default 'comprada',
  tipo_fuente text not null default 'masiva', -- masiva | principales | comprada, ver FUENTE_TYPES
  -- Si está en true, session_get_leads reparte los leads de esta base antes
  -- que los de las demás de su misma franja de calidad.
  prioridad boolean not null default false,
  -- Si está en false, session_get_leads no reparte ningún lead de esta base
  -- (pausa reversible de la base entera, sin borrar ni descartar sus contactos).
  activa boolean not null default true,
  costo numeric not null default 0, -- cuánto se pagó por esta lista, para el reporte de ROI por base
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
  -- Estado del lead (nuevo/contactado/contestado/interesado/cargado/descartado/
  -- para_retomar, ver LEAD_STATES en lib.js) y su asignación diaria por el
  -- reparto automático (session_get_leads, security definer).
  -- `para_retomar` es a dónde va un contacto reciclado automáticamente (ver
  -- `veces_reciclado`) — no es lo mismo que "nuevo", ya se tocó antes.
  estado text not null default 'nuevo',
  motivo_descarte text,
  ultimo_contacto date,
  asignado_a text, -- nombre de empleado, igual que trabajada_por/agregado_por
  fecha_asignacion date,
  estado_actualizado_at timestamptz, -- cuándo cambió `estado` por última vez (para la cola de urgentes y el reciclado)
  -- Pausa reversible de un contacto puntual (sale del reparto automático sin
  -- descartarlo). Distinto de `activa` en databases, que pausa la base entera.
  pausado boolean not null default false,
  motivo_pausa text,
  notas text, -- texto libre, separado de motivo_descarte (que es una lista cerrada)
  -- Cuántas veces el reciclado automático lo liberó sin que nadie avanzara.
  -- Al llegar a app_config.max_reciclados, en vez de reciclarse de nuevo pasa
  -- directo a descartado (ver session_get_leads).
  veces_reciclado int not null default 0,
  -- Resumen corto del último evento *humano* (no se toca en el reciclado
  -- automático) — se muestra al abrir un contacto en para_retomar. El
  -- historial completo en vivo sigue viviendo en contact_events.
  ultimo_evento_resumen text,
  created_at timestamptz not null default now()
);
create index contacts_base_idx on contacts (base_id);

-- Recordatorios programados por contacto ("recordame esto en X días") — cola
-- separada de "Urgentes" (esa es por inactividad de 2hs, esto es a pedido).
create table contact_reminders (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  empleado text not null,
  recordar_en timestamptz not null,
  nota text,
  cumplido boolean not null default false,
  created_at timestamptz not null default now()
);
create index contact_reminders_due_idx on contact_reminders (cumplido, recordar_en);
create index contact_reminders_contact_idx on contact_reminders (contact_id);

-- Respaldo permanente: historial de todo lo que pasa en cada base, no se borra nunca.
create table contact_events (
  id uuid primary key default gen_random_uuid(),
  base_id uuid not null,
  contact_id uuid,
  empleado text,
  accion text not null, -- creado | enviado | estado:<x> | urgente:<x> | pausado | despausado | nota | recordatorio_creado | reciclado_automatico | descartado_automatico | seguimiento
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
-- Leída por session_get_leads/session_my_status/admin_count_publicidad etc.
-- (todas security definer) al repartir leads y armar reportes. Los valores
-- por defecto de acá son los que usan esas funciones si la fila no existe.
create table app_config (
  key text primary key,
  value text
);

-- ---------- Configuración sensible (clave/valor) — SOLO el PIN de admin hasheado ----------
-- INFERIDA — nunca tuvo una migración con su CREATE TABLE; se reconstruyó a
-- partir de verify_admin_pin, que es la única función que la toca:
--   select exists (select 1 from app_settings
--     where key = 'admin_pin_hash' and value = extensions.crypt(input_pin, value))
-- Separada de app_config a propósito — es la única tabla con un dato
-- verdaderamente sensible (el PIN de Admin), nunca se lee desde el cliente.
create table app_settings (
  key text primary key,
  value text
);

-- ---------- Identificadores de cliente ya vistos (autocompletar en Operaciones) ----------
create table clientes (
  identificador text primary key,
  created_at timestamptz not null default now()
);

-- ---------- Contador de mensajes de publicidad ----------
-- Log de eventos (no un contador acumulado), para poder filtrar por fecha o
-- por turno. `campana` queda listo para el día que haya más de una campaña
-- activa a la vez. `shift_id` se agregó después (antes solo contaba por
-- fecha/ventana horaria aproximada) — eventos viejos pueden tener shift_id null.
create table publicidad_eventos (
  id uuid primary key default gen_random_uuid(),
  empleado text not null,
  campana text not null default 'general',
  shift_id uuid references shifts(id),
  created_at timestamptz not null default now()
);
create index publicidad_eventos_created_idx on publicidad_eventos (created_at);
create index publicidad_eventos_shift_idx on publicidad_eventos (shift_id);

-- ---------- Mapeo usuario de Ganamos → cliente/origen ----------
create table ganamos_usuarios (
  usuario text primary key,
  cliente text not null,
  origen text check (origen in ('nuevo', 'derivado', 'lista')), -- opcional: lo completa el cruce con lo que anotó el empleado (carga rápida), no el admin al importar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Freno de fuerza bruta en login (admin y empleado) ----------
create table login_attempts (
  id bigserial primary key,
  tipo text not null, -- 'admin' | 'empleado'
  created_at timestamptz not null default now()
);
create index login_attempts_tipo_created_idx on login_attempts (tipo, created_at);

-- ---------- Sesiones de "refuerzo en Bases" (empleado ayudando sin caja propia) ----------
-- INFERIDA — nunca tuvo una migración con su CREATE TABLE; reconstruida
-- leyendo session_my_status / session_close_refuerzo / tiene_refuerzo_abierto /
-- admin_list_refuerzos y los `update ... set fin = now()` desde los logins.
create table refuerzo_sessions (
  id uuid primary key default gen_random_uuid(),
  empleado text not null,
  inicio timestamptz not null default now(),
  fin timestamptz
);
create index refuerzo_sessions_empleado_idx on refuerzo_sessions (empleado, fin);

-- ---------- Log de accesos exitosos (admin y empleado) ----------
-- INFERIDA — nunca tuvo una migración con su CREATE TABLE; reconstruida
-- leyendo admin_login / verify_employee_pin / admin_list_access_log.
create table access_log (
  id bigserial primary key,
  tipo text not null, -- 'admin' | 'empleado'
  nombre text not null,
  created_at timestamptz not null default now()
);
create index access_log_created_idx on access_log (created_at);

-- ============================================================
-- SEGURIDAD (RLS) — estado final tras la auditoría de seguridad completa
-- (migrations/2026-10-10-auditoria-*). Como no hay login por email, el
-- acceso real lo dan las funciones admin_*/session_* de más abajo, todas
-- `security definer` (no dependen de estas políticas). Las tablas que solo
-- se tocan a través de esas funciones quedan CERRADAS del todo a la clave
-- pública (anon/authenticated): ni lectura ni escritura directa.
-- ============================================================
alter table employees enable row level security;
alter table sessions enable row level security;
alter table wallets enable row level security;
alter table shifts enable row level security;
alter table databases enable row level security;
alter table contacts enable row level security;
alter table contact_events enable row level security;
alter table assignments enable row level security;
alter table app_config enable row level security;
alter table app_settings enable row level security;
alter table clientes enable row level security;
alter table contact_reminders enable row level security;
alter table publicidad_eventos enable row level security;
alter table ganamos_usuarios enable row level security;
alter table login_attempts enable row level security;
alter table refuerzo_sessions enable row level security;
alter table access_log enable row level security;

-- Sin política = todo acceso directo denegado (solo entra por las funciones
-- security definer). Esto es así para: employees, sessions, contacts,
-- contact_events, assignments, contact_reminders, app_settings,
-- publicidad_eventos, ganamos_usuarios, login_attempts, refuerzo_sessions,
-- access_log — NINGUNA tiene política.

-- wallets: la app lee los nombres de billeteras directo desde el cliente
-- (se necesita antes de loguearse) — toda escritura pasa por funciones.
create policy "lectura publica" on wallets for select using (true);

-- app_config: lectura pública (valores de config no sensibles), escritura
-- solo vía admin_set_config.
create policy "lectura publica" on app_config for select using (true);

-- clientes: identificadores para autocompletar en Operaciones, sin datos
-- sensibles — abierta del todo, cualquier empleado logueado la usa directo.
create policy "acceso app" on clientes for all using (true) with check (true);

-- shifts y databases: NO tienen política de SELECT — se cerraron en la
-- auditoría (paso 1B). Antes eran de lectura pública; ahora toda lectura
-- pasa por admin_list_shifts_*/admin_list_databases/session_mi_turno_abierto/
-- session_turno_abierto_actual/session_ultimo_cierre_arrastre.

-- ============================================================
-- FUNCIONES — volcado real de producción (pg_get_functiondef), tal cual
-- están hoy. Se excluyó a propósito una segunda versión de
-- admin_importar_ganamos_operaciones con 3 parámetros que sigue viva en
-- producción en paralelo a la de 4 — es un remanente del bug de funciones
-- duplicadas que no se terminó de limpiar (ver notas al final).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_active_sessions(input_admin_pin text)
 RETURNS TABLE(nombre text, entro_a timestamp with time zone, vence_a timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;
  return query select e.nombre, s.created_at, s.expires_at from sessions s
    join employees e on e.id = s.empleado_id
    where s.expires_at > now()
    order by s.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_activity_por_empleado_fecha(input_admin_pin text)
 RETURNS TABLE(empleado text, fecha date, contactaron integer, contestaron integer, cargaron integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select
    e.empleado,
    (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
    count(*) filter (where e.resultado <> 'nuevo')::int as contactaron,
    count(*) filter (where e.resultado in ('contestado', 'interesado', 'cargado'))::int as contestaron,
    count(*) filter (where e.resultado = 'cargado')::int as cargaron
  from (
    select contact_events.empleado, contact_events.created_at, split_part(contact_events.accion, ':', 2) as resultado
    from contact_events
    where (contact_events.accion like 'estado:%' or contact_events.accion like 'urgente:%')
      and contact_events.empleado is not null and contact_events.empleado <> 'sistema'
  ) e
  group by e.empleado, (e.created_at at time zone 'America/Argentina/Buenos_Aires')::date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_activity_por_turno(input_admin_pin text)
 RETURNS TABLE(shift_id uuid, contactaron integer, contestaron integer, cargaron integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  with ventanas as (
    select
      s.id,
      s.responsable,
      (s.fecha + s.hora_inicio) at time zone 'America/Argentina/Buenos_Aires' as inicio,
      case
        when s.hora_fin is null then now()
        when s.hora_fin < s.hora_inicio then ((s.fecha + 1) + s.hora_fin) at time zone 'America/Argentina/Buenos_Aires'
        else (s.fecha + s.hora_fin) at time zone 'America/Argentina/Buenos_Aires'
      end as fin
    from shifts s
  )
  select
    v.id as shift_id,
    count(*) filter (where split_part(ce.accion, ':', 2) <> 'nuevo')::int as contactaron,
    count(*) filter (where split_part(ce.accion, ':', 2) in ('contestado', 'interesado', 'cargado'))::int as contestaron,
    count(*) filter (where split_part(ce.accion, ':', 2) = 'cargado')::int as cargaron
  from ventanas v
  left join contact_events ce
    on ce.empleado = v.responsable
    and (ce.accion like 'estado:%' or ce.accion like 'urgente:%')
    and ce.created_at >= v.inicio
    and ce.created_at < v.fin
  group by v.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_employee(input_admin_pin text, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if empleado_pin_en_uso(new_pin) then return false; end if;
  insert into employees (nombre, pin_hash, recibe_leads, cupo_leads)
  values (new_nombre, extensions.crypt(new_pin, extensions.gen_salt('bf')), new_recibe_leads, new_cupo_leads);
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_wallet(input_admin_pin text, nombre text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  insert into wallets (nombre, orden) values (nombre, (select coalesce(max(orden), 0) + 1 from wallets));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_corregir_stock_inicio(input_admin_pin text, target_id uuid, plataforma text, nuevo_valor text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  if plataforma not in ('B', 'G') then
    return false;
  end if;

  update shifts set
    stock_inicio = jsonb_set(coalesce(stock_inicio, '{}'::jsonb), array[plataforma], to_jsonb(nuevo_valor)),
    updated_at = now()
  where id = target_id;

  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_count_publicidad(input_admin_pin text, fecha_desde date DEFAULT NULL::date, fecha_hasta date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int;
begin
  if verify_admin_pin(input_admin_pin) is not true then return 0; end if;

  select count(*) into v_count from publicidad_eventos
  where (fecha_desde is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date >= fecha_desde)
    and (fecha_hasta is null or (created_at at time zone 'America/Argentina/Buenos_Aires')::date <= fecha_hasta);

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_base(input_admin_pin text, nombre text, tipo_fuente text, nuevo_costo numeric DEFAULT 0)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  insert into databases (nombre, tipo, tipo_fuente, costo) values (nombre, 'comprada', tipo_fuente, nuevo_costo);
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_employee(input_admin_pin text, target_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  update employees set activo = false where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_base(input_admin_pin text, target_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  delete from contacts where base_id = target_id;
  delete from databases where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_wallet(input_admin_pin text, target_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  delete from wallets where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_deshacer_importacion_ganamos(input_admin_pin text, target_shift_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ops_actuales jsonb;
  v_ops_filtradas jsonb;
  v_quitadas int;
begin
  if not verify_admin_pin(input_admin_pin) then
    return -1;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return -1;
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is null;

  v_quitadas := jsonb_array_length(v_ops_actuales) - jsonb_array_length(v_ops_filtradas);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_quitadas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_deshacer_ultimo_lote_ganamos(input_admin_pin text, target_shift_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ops_actuales jsonb;
  v_ultimo_lote text;
  v_ops_filtradas jsonb;
  v_tx_sacados text[];
begin
  if not verify_admin_pin(input_admin_pin) then
    return null;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return null;
  end if;

  select max(elem->>'_lote')
    into v_ultimo_lote
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null and elem->>'_lote' is not null;

  if v_ultimo_lote is null then
    return '{}';
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_sacados
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null and elem->>'_lote' = v_ultimo_lote;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(v_ops_actuales) as elem
    where not (elem->>'ganamos_tx' is not null and elem->>'_lote' = v_ultimo_lote);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_tx_sacados;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_ganamos_usuarios(input_admin_pin text)
 RETURNS SETOF ganamos_usuarios
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from ganamos_usuarios
  where verify_admin_pin(input_admin_pin) = true
  order by updated_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_import_contacts(input_admin_pin text, target_base uuid, rows jsonb)
 RETURNS TABLE(insertados integer, duplicados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_insertados int := 0; v_duplicados int := 0;
begin
  if verify_admin_pin(input_admin_pin) is not true then
    return query select 0, 0;
    return;
  end if;

  with candidatos as (
    select
      r->>'nombre' as nombre,
      coalesce(r->>'numero', '') as numero
    from jsonb_array_elements(rows) r
    where coalesce(r->>'nombre', '') <> ''
  ),
  a_insertar as (
    select c.nombre, c.numero
    from candidatos c
    where c.numero = '' or not exists (
      select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
    )
  ),
  a_duplicados as (
    select c.nombre, c.numero
    from candidatos c
    where c.numero <> '' and exists (
      select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
    )
  ),
  hechos as (
    insert into contacts (base_id, nombre, numero, agregado_por)
    select target_base, nombre, numero, 'admin' from a_insertar
    returning id
  )
  select (select count(*) from hechos), (select count(*) from a_duplicados)
  into v_insertados, v_duplicados;

  return query select v_insertados, v_duplicados;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_importar_ganamos_operaciones(input_admin_pin text, target_shift_id uuid, nuevas_ops jsonb, nuevo_saldo_gana text DEFAULT NULL::text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ops_actuales jsonb;
  v_tx_existentes text[];
  v_ops_filtradas jsonb;
  v_tx_agregados text[];
  v_lote text := extract(epoch from clock_timestamp())::text;
  v_creado_at timestamptz;
  v_siguiente_id uuid;
begin
  if not verify_admin_pin(input_admin_pin) then
    return null;
  end if;

  select ops, created_at into v_ops_actuales, v_creado_at from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return null;
  end if;

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_existentes
    from jsonb_array_elements(v_ops_actuales) as elem
    where elem->>'ganamos_tx' is not null;

  select coalesce(jsonb_agg(elem || jsonb_build_object('_lote', v_lote)), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(nuevas_ops) as elem
    where elem->>'ganamos_tx' is null or not (elem->>'ganamos_tx' = any(v_tx_existentes));

  select coalesce(array_agg(elem->>'ganamos_tx'), '{}')
    into v_tx_agregados
    from jsonb_array_elements(v_ops_filtradas) as elem
    where elem->>'ganamos_tx' is not null;

  update shifts set
    ops = v_ops_actuales || v_ops_filtradas,
    stock_cierre = case
      when nuevo_saldo_gana is not null then
        jsonb_set(
          jsonb_set(coalesce(stock_cierre, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana)),
          '{G_real}', 'true'::jsonb
        )
      else stock_cierre
    end,
    updated_at = now()
  where id = target_shift_id;

  -- Propagar el saldo real al turno siguiente (el que se abrió justo después de este,
  -- el próximo por fecha de creación, sin importar si ya cerró o sigue abierto).
  if nuevo_saldo_gana is not null then
    select id into v_siguiente_id
      from shifts
      where archivado = false and created_at > v_creado_at
      order by created_at asc limit 1;

    if v_siguiente_id is not null then
      update shifts set
        stock_inicio = jsonb_set(coalesce(stock_inicio, '{}'::jsonb), '{G}', to_jsonb(nuevo_saldo_gana)),
        updated_at = now()
      where id = v_siguiente_id;
    end if;
  end if;

  return v_tx_agregados;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_justify_shift(input_admin_pin text, target_id uuid, campo text, justificado boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  update shifts
    set error_justificado = jsonb_set(coalesce(error_justificado, '{}'::jsonb), array[campo], to_jsonb(justificado))
    where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_access_log(input_admin_pin text)
 RETURNS SETOF access_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;
  return query select * from access_log order by created_at desc limit 20;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_contacts(input_admin_pin text)
 RETURNS SETOF contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;
  return query select * from contacts;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_databases(input_admin_pin text)
 RETURNS SETOF databases
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from databases
  where verify_admin_pin(input_admin_pin) = true
  order by created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_employees(input_admin_pin text)
 RETURNS TABLE(id uuid, nombre text, activo boolean, recibe_leads boolean, cupo_leads integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.nombre, e.activo, e.recibe_leads, e.cupo_leads from employees e
  where verify_admin_pin(input_admin_pin) = true
  order by e.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_events(input_admin_pin text, target_base_id uuid)
 RETURNS SETOF contact_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;
  return query select * from contact_events where base_id = target_base_id order by created_at desc limit 100;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_refuerzos(input_admin_pin text)
 RETURNS SETOF refuerzo_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;
  return query select * from refuerzo_sessions order by inicio desc limit 50;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_shifts_abiertos(input_admin_pin text)
 RETURNS SETOF shifts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and status = 'abierto' and archivado = false
  order by updated_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_shifts_archivados(input_admin_pin text)
 RETURNS SETOF shifts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and archivado = true
  order by updated_at desc
  limit 200;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_shifts_cerrados(input_admin_pin text)
 RETURNS SETOF shifts
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from shifts
  where verify_admin_pin(input_admin_pin) = true
    and status = 'cerrado' and archivado = false
  order by cerrado_at desc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.admin_login(input_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ok boolean; intentos_recientes int;
begin
  delete from login_attempts where created_at < now() - interval '1 hour';

  select count(*) into intentos_recientes from login_attempts
  where tipo = 'admin' and created_at > now() - interval '5 minutes';

  if intentos_recientes >= 10 then
    perform pg_sleep(1);
    return false;
  end if;

  select verify_admin_pin(input_pin) into ok;

  if ok then
    insert into access_log (tipo, nombre) values ('admin', 'Admin');
  else
    insert into login_attempts (tipo) values ('admin');
    perform pg_sleep(0.5);
  end if;

  return ok;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_seguimiento(input_admin_pin text, target_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;

  update contacts set
    estado = 'contactado',
    ultimo_contacto = current_date,
    estado_actualizado_at = now(),
    ultimo_evento_resumen = format('Admin marcó en seguimiento el %s', to_char(now(), 'DD/MM HH24:MI'))
  where id = target_id
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, 'admin', 'seguimiento', '{}'::jsonb);
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_publicidad_por_turno(input_admin_pin text)
 RETURNS TABLE(shift_id uuid, cantidad integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select s.id as shift_id, count(pe.id)::int as cantidad
  from shifts s
  left join publicidad_eventos pe on pe.shift_id = s.id
  group by s.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_quitar_operaciones_ganamos(input_admin_pin text, target_shift_id uuid, tx_a_quitar text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ops_actuales jsonb;
  v_ops_filtradas jsonb;
  v_quitadas int;
begin
  if not verify_admin_pin(input_admin_pin) then
    return -1;
  end if;

  select ops into v_ops_actuales from shifts where id = target_shift_id and status = 'cerrado' for update;
  if v_ops_actuales is null then
    return -1;
  end if;

  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_ops_filtradas
    from jsonb_array_elements(v_ops_actuales) as elem
    where not (elem->>'ganamos_tx' = any(tx_a_quitar));

  v_quitadas := jsonb_array_length(v_ops_actuales) - jsonb_array_length(v_ops_filtradas);

  update shifts set ops = v_ops_filtradas, updated_at = now() where id = target_shift_id;

  return v_quitadas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reactivate_employee(input_admin_pin text, target_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  update employees set activo = true where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_wallet(input_admin_pin text, target_id integer, nuevo_nombre text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  update wallets set nombre = nuevo_nombre where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_contacts(input_admin_pin text, query text)
 RETURNS TABLE(id uuid, nombre text, numero text, estado text, base_id uuid, base_nombre text, asignado_a text, pausado boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return; end if;

  return query
  select c.id, c.nombre, c.numero, c.estado, c.base_id, d.nombre, c.asignado_a, c.pausado
  from contacts c
  join databases d on d.id = c.base_id
  where c.nombre ilike '%' || query || '%' or c.numero ilike '%' || query || '%'
  order by c.created_at desc
  limit 200;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_base_costo(input_admin_pin text, target_id uuid, nuevo_costo numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then return false; end if;
  update databases set costo = nuevo_costo where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_config(input_admin_pin text, config_key text, config_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update app_config set value = config_value where key = config_key;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_ganamos_usuario(input_admin_pin text, p_usuario text, p_cliente text, p_origen text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  insert into ganamos_usuarios (usuario, cliente, origen, updated_at)
  values (p_usuario, p_cliente, p_origen, now())
  on conflict (usuario) do update set
    cliente = excluded.cliente, origen = coalesce(excluded.origen, ganamos_usuarios.origen), updated_at = now();
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_archivado(input_admin_pin text, target_id uuid, nuevo_archivado boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update shifts set archivado = nuevo_archivado, updated_at = now() where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_base_activa(input_admin_pin text, target_id uuid, nueva_activa boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update databases set activa = nueva_activa where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_base_prioridad(input_admin_pin text, target_id uuid, nueva_prioridad boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update databases set prioridad = nueva_prioridad where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_excluir_arrastre(input_admin_pin text, target_id uuid, nuevo_excluir boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not verify_admin_pin(input_admin_pin) then
    return false;
  end if;
  update shifts set excluir_arrastre = nuevo_excluir, updated_at = now() where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_pausado(input_admin_pin text, target_id uuid, nuevo_pausado boolean, motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;

  update contacts set
    pausado = nuevo_pausado,
    motivo_pausa = case when nuevo_pausado then motivo else null end
  where id = target_id
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, 'admin', case when nuevo_pausado then 'pausado' else 'despausado' end,
      case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_employee(input_admin_pin text, target_id uuid, new_nombre text, new_pin text, new_recibe_leads boolean, new_cupo_leads integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if verify_admin_pin(input_admin_pin) is not true then return false; end if;
  if new_pin is not null and new_pin <> '' and empleado_pin_en_uso(new_pin, target_id) then return false; end if;

  update employees set
    nombre = new_nombre,
    pin_hash = case when new_pin is not null and new_pin <> '' then extensions.crypt(new_pin, extensions.gen_salt('bf')) else pin_hash end,
    recibe_leads = new_recibe_leads,
    cupo_leads = new_cupo_leads
  where id = target_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.empleado_pin_en_uso(check_pin text, excluir_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  return exists (
    select 1 from employees
    where activo = true
      and (excluir_id is null or id <> excluir_id)
      and pin_hash = extensions.crypt(check_pin, pin_hash)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_refuerzo_now(nombre_empleado text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from shifts s
    where s.status = 'abierto' and s.archivado = false and s.responsable <> nombre_empleado
  );
$function$;

-- rls_auto_enable: función de evento, pensada para dispararse sola con cada
-- `CREATE TABLE` nueva en el schema public y activarle RLS automáticamente.
-- El dump de producción solo trae la función — el EVENT TRIGGER que la
-- conecta no se pudo confirmar contra la base real, así que el de acá
-- abajo es INFERIDO a partir de lo que la función espera recibir
-- (CREATE TABLE / CREATE TABLE AS / SELECT INTO). Si en Supabase no existe
-- tal cual, cada CREATE TABLE nueva requiere su propio
-- `alter table ... enable row level security` a mano.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.session_add_contact(input_token uuid, nombre text, numero text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; target_base uuid; new_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return null; end if;

  select id into target_base from databases order by created_at desc limit 1;
  if target_base is null then return null; end if;

  insert into contacts (base_id, nombre, numero, agregado_por, asignado_a, fecha_asignacion)
  values (target_base, nombre, numero, emp.nombre, emp.nombre, current_date)
  returning id into new_id;

  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  values (target_base, new_id, emp.nombre, 'creado', jsonb_build_object('nombre', nombre));
  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_add_publicidad_evento(input_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_shift_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return false; end if;

  insert into publicidad_eventos (empleado, shift_id) values (emp.nombre, v_shift_id);
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_add_reminder(input_token uuid, target_id uuid, recordar_en timestamp with time zone, nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; c record; new_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return null; end if;

  select * into c from contacts where id = target_id and asignado_a = emp.nombre;
  if c.id is null then return null; end if;

  insert into contact_reminders (contact_id, empleado, recordar_en, nota)
  values (target_id, emp.nombre, recordar_en, nota)
  returning id into new_id;

  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  values (c.base_id, c.id, emp.nombre, 'recordatorio_creado', jsonb_build_object('recordar_en', recordar_en, 'nota', nota));

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_autosave_turno(input_token uuid, target_id uuid, nuevo_bill_inicio jsonb, nuevo_bill_cierre jsonb, nuevo_stock_inicio jsonb, nuevo_stock_cierre jsonb, nuevos_ops jsonb, nuevas_bajadas jsonb, nuevos_movs jsonb, nuevas_notas text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_updated int; v_ops jsonb;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  -- Vínculo con Bases para operaciones origen "lista".
  select coalesce(jsonb_agg(
    case
      when (elem->>'origen') = 'lista'
        and (elem->>'origen_base_id') is null
        and coalesce(elem->>'cliente', '') <> ''
      then elem || coalesce(
        (select jsonb_build_object('origen_base_id', c.base_id, 'origen_contact_id', c.id)
         from contacts c
         where c.estado = 'cargado' and c.numero <> ''
           and c.numero like '%' || (elem->>'cliente')
         order by c.estado_actualizado_at desc nulls last
         limit 1),
        '{}'::jsonb
      )
      else elem
    end
  ), '[]'::jsonb)
  into v_ops
  from jsonb_array_elements(nuevos_ops) elem;

  update shifts set
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = v_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas,
    updated_at = now()
  where id = target_id and responsable = emp.nombre and status = 'abierto';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_claim_urgent(input_token uuid, target_id uuid, nuevo_estado text, motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    estado = nuevo_estado, trabajada_por = emp.nombre, fecha_trabajo = current_date,
    ultimo_contacto = current_date, estado_actualizado_at = now(), asignado_a = emp.nombre, fecha_asignacion = current_date,
    enviado = (nuevo_estado <> 'nuevo'),
    contestado = (nuevo_estado in ('contestado', 'interesado', 'cargado')),
    cargo = (nuevo_estado = 'cargado'),
    motivo_descarte = case when nuevo_estado = 'descartado' then motivo else null end,
    ultimo_evento_resumen = format('%s tomó un urgente → "%s" el %s', emp.nombre, nuevo_estado, to_char(now(), 'DD/MM HH24:MI'))
  where id = target_id
    and estado in ('contestado', 'interesado')
    and estado_actualizado_at < now() - interval '2 hours'
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'urgente:' || nuevo_estado, case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_close_refuerzo(input_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;
  update refuerzo_sessions set fin = now() where empleado = emp.nombre and fin is null;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_close_turno(input_token uuid, target_id uuid, nueva_hora_fin time without time zone, nuevo_turno_label text, nuevo_bill_inicio jsonb, nuevo_bill_cierre jsonb, nuevo_stock_inicio jsonb, nuevo_stock_cierre jsonb, nuevos_ops jsonb, nuevas_bajadas jsonb, nuevos_movs jsonb, nuevas_notas text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_updated int; v_ops jsonb;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return false;
  end if;

  -- Mismo vínculo que en session_autosave_turno, se corre también al cerrar
  -- por si se cargó alguna operación justo antes de cerrar.
  select coalesce(jsonb_agg(
    case
      when (elem->>'origen') = 'lista'
        and (elem->>'origen_base_id') is null
        and coalesce(elem->>'cliente', '') <> ''
      then elem || coalesce(
        (select jsonb_build_object('origen_base_id', c.base_id, 'origen_contact_id', c.id)
         from contacts c
         where c.estado = 'cargado' and c.numero <> ''
           and c.numero like '%' || (elem->>'cliente')
         order by c.estado_actualizado_at desc nulls last
         limit 1),
        '{}'::jsonb
      )
      else elem
    end
  ), '[]'::jsonb)
  into v_ops
  from jsonb_array_elements(nuevos_ops) elem;

  update shifts set
    status = 'cerrado',
    hora_fin = nueva_hora_fin,
    turno_label = nuevo_turno_label,
    bill_inicio = nuevo_bill_inicio, bill_cierre = nuevo_bill_cierre,
    stock_inicio = nuevo_stock_inicio, stock_cierre = nuevo_stock_cierre,
    ops = v_ops, bajadas = nuevas_bajadas, movs = nuevos_movs, notas = nuevas_notas,
    updated_at = now(), cerrado_at = now()
  where id = target_id and responsable = emp.nombre and status = 'abierto';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_complete_reminder(input_token uuid, target_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_updated int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contact_reminders set cumplido = true
  where id = target_id and empleado = emp.nombre;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_count_publicidad_hoy(input_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_shift_id uuid; v_count int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return 0; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return 0; end if;

  select count(*) into v_count from publicidad_eventos where shift_id = v_shift_id;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_employee(input_token uuid)
 RETURNS TABLE(id uuid, nombre text, recibe_leads boolean, cupo_leads integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.nombre, e.recibe_leads, e.cupo_leads from sessions s
  join employees e on e.id = s.empleado_id
  where s.token = input_token and s.expires_at > now() and e.activo = true;
$function$;

CREATE OR REPLACE FUNCTION public.session_end_login(input_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from sessions where token = input_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_get_contact_events(input_token uuid, target_id uuid)
 RETURNS SETOF contact_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  if not exists (select 1 from contacts where id = target_id and asignado_a = emp.nombre) then
    return;
  end if;

  return query select * from contact_events where contact_id = target_id order by created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_get_leads(input_token uuid)
 RETURNS SETOF contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  emp record; cupo int; activos int; faltan int; es_refuerzo boolean;
  pct_relleno numeric; relleno_objetivo int; tomados_relleno int := 0;
  resto int; tomados_resto int := 0; sobrante int;
  horas_recicla_contactado int; horas_recicla int; max_recic int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  perform pg_advisory_xact_lock(hashtext(emp.nombre));

  select coalesce((select value::int from app_config where key = 'horas_reciclar_contactado'), 18) into horas_recicla_contactado;
  select coalesce((select value::int from app_config where key = 'horas_reciclar_contestado'), 24) into horas_recicla;
  select coalesce((select value::int from app_config where key = 'max_reciclados'), 6) into max_recic;

  with actualizados as (
    update contacts c set
      asignado_a = null,
      veces_reciclado = c.veces_reciclado + 1,
      estado = case when c.veces_reciclado + 1 < max_recic then 'para_retomar' else 'descartado' end,
      motivo_descarte = case when c.veces_reciclado + 1 >= max_recic then 'Sin respuesta tras varios intentos' else c.motivo_descarte end,
      estado_actualizado_at = now()
    from (
      select id from contacts
      where estado = 'contactado' and asignado_a is not null
        and estado_actualizado_at < now() - (horas_recicla_contactado || ' hours')::interval
      for update skip locked
    ) sub
    where c.id = sub.id
    returning c.id, c.base_id, c.veces_reciclado, c.estado
  )
  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  select base_id, id, 'sistema',
    case when estado = 'descartado' then 'descartado_automatico' else 'reciclado_automatico' end,
    jsonb_build_object('veces_reciclado', veces_reciclado)
  from actualizados;

  with actualizados as (
    update contacts c set
      asignado_a = null,
      veces_reciclado = c.veces_reciclado + 1,
      estado = case when c.veces_reciclado + 1 < max_recic then 'para_retomar' else 'descartado' end,
      motivo_descarte = case when c.veces_reciclado + 1 >= max_recic then 'Sin respuesta tras varios intentos' else c.motivo_descarte end,
      estado_actualizado_at = now()
    from (
      select id from contacts
      where estado in ('contestado', 'interesado') and asignado_a is not null
        and estado_actualizado_at < now() - (horas_recicla || ' hours')::interval
      for update skip locked
    ) sub
    where c.id = sub.id
    returning c.id, c.base_id, c.veces_reciclado, c.estado
  )
  insert into contact_events (base_id, contact_id, empleado, accion, detalle)
  select base_id, id, 'sistema',
    case when estado = 'descartado' then 'descartado_automatico' else 'reciclado_automatico' end,
    jsonb_build_object('veces_reciclado', veces_reciclado)
  from actualizados;

  if emp.recibe_leads is not true then
    return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
    return;
  end if;

  select is_refuerzo_now(emp.nombre) into es_refuerzo;
  if es_refuerzo then
    select coalesce((select value::int from app_config where key = 'cupo_refuerzo_leads'), 20) into cupo;
  else
    select coalesce(emp.cupo_leads, (select value::int from app_config where key = 'cupo_diario_leads'), 35) into cupo;
  end if;

  select count(*) into activos from contacts
  where asignado_a = emp.nombre and fecha_asignacion = current_date
    and estado in ('nuevo', 'contactado', 'contestado', 'interesado');
  faltan := cupo - activos;

  if faltan > 0 then
    select coalesce((select value::numeric from app_config where key = 'porcentaje_relleno'), 15) into pct_relleno;
    relleno_objetivo := ceil(faltan * pct_relleno / 100.0);

    if relleno_objetivo > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente = 'masiva'
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit relleno_objetivo
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
      get diagnostics tomados_relleno = row_count;
    end if;

    resto := faltan - tomados_relleno;
    if resto > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar') and d.tipo_fuente in ('principales', 'comprada')
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit resto
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
      get diagnostics tomados_resto = row_count;
    end if;

    sobrante := faltan - tomados_relleno - tomados_resto;
    if sobrante > 0 then
      update contacts c
      set asignado_a = emp.nombre, fecha_asignacion = current_date
      from (
        select c2.id from contacts c2
        join databases d on d.id = c2.base_id
        where c2.estado in ('nuevo', 'contactado', 'para_retomar')
          and d.activa = true and c2.pausado = false
          and (c2.asignado_a is null or c2.fecha_asignacion < current_date)
        order by d.prioridad desc, (c2.estado = 'nuevo') desc, random()
        limit sobrante
        for update of c2 skip locked
      ) sub
      where c.id = sub.id
        and (c.asignado_a is null or c.fecha_asignacion < current_date);
    end if;
  end if;

  select count(*) into activos from contacts
  where asignado_a = emp.nombre and fecha_asignacion = current_date
    and estado in ('nuevo', 'contactado', 'contestado', 'interesado');

  if activos > cupo then
    update contacts c set asignado_a = null, fecha_asignacion = null
    from (
      select id from contacts
      where asignado_a = emp.nombre and fecha_asignacion = current_date and estado = 'nuevo'
      order by id
      limit (activos - cupo)
    ) sub
    where c.id = sub.id;
  end if;

  return query select * from contacts where asignado_a = emp.nombre and fecha_asignacion = current_date;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_list_reminders_pendientes(input_token uuid)
 RETURNS TABLE(id uuid, contact_id uuid, nota text, recordar_en timestamp with time zone, contacto_nombre text, contacto_numero text, base_nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select r.id, r.contact_id, r.nota, r.recordar_en, c.nombre, c.numero, d.nombre
  from contact_reminders r
  join contacts c on c.id = r.contact_id
  join databases d on d.id = c.base_id
  where r.empleado = emp.nombre and r.cumplido = false and r.recordar_en <= now()
  order by r.recordar_en asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_logout(input_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is not null then
    update refuerzo_sessions set fin = now() where empleado = emp.nombre and fin is null;
  end if;
  delete from sessions where token = input_token;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_mi_turno_abierto(input_token uuid)
 RETURNS SETOF shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  order by created_at desc limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_mis_mensajes_hoy(input_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_count int;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    return 0;
  end if;

  select count(*) into v_count from contacts
  where trabajada_por = emp.nombre and fecha_trabajo = current_date and enviado = true;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_my_status(input_token uuid)
 RETURNS TABLE(es_refuerzo boolean, cupo integer, refuerzo_inicio timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; ref boolean; c int; rs record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  select is_refuerzo_now(emp.nombre) into ref;

  if ref then
    select coalesce((select value::int from app_config where key = 'cupo_refuerzo_leads'), 20) into c;
    select * into rs from refuerzo_sessions where empleado = emp.nombre and fin is null order by inicio desc limit 1;
    if rs.id is null then
      insert into refuerzo_sessions (empleado) values (emp.nombre) returning * into rs;
    end if;
    return query select true, c, rs.inicio;
  else
    -- Si dejaste de ser refuerzo (por ejemplo, cerraron la caja principal), se cierra sola.
    update refuerzo_sessions set fin = now() where empleado = emp.nombre and fin is null;
    select coalesce((select value::int from app_config where key = 'cupo_diario_leads'), 35) into c;
    return query select false, c, null::timestamptz;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_open_turno(input_token uuid, nueva_fecha date, nueva_hora_inicio time without time zone, nuevo_turno_label text, nuevo_bill_inicio jsonb, nuevo_stock_inicio jsonb)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_result shifts;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then
    raise exception 'sesión inválida';
  end if;

  insert into shifts (fecha, hora_inicio, responsable, turno_label, bill_inicio, stock_inicio, status)
  values (nueva_fecha, nueva_hora_inicio, emp.nombre, nuevo_turno_label, nuevo_bill_inicio, nuevo_stock_inicio, 'abierto')
  returning * into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_remove_publicidad_evento(input_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; v_shift_id uuid; v_id uuid;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  select id into v_shift_id from shifts
  where status = 'abierto' and archivado = false and responsable = emp.nombre
  limit 1;
  if v_shift_id is null then return false; end if;

  select id into v_id from publicidad_eventos
  where empleado = emp.nombre and shift_id = v_shift_id
  order by created_at desc
  limit 1;
  if v_id is null then return false; end if;

  delete from publicidad_eventos where id = v_id;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_set_estado(input_token uuid, target_id uuid, nuevo_estado text, motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    estado = nuevo_estado, trabajada_por = emp.nombre, fecha_trabajo = current_date,
    ultimo_contacto = current_date, estado_actualizado_at = now(),
    enviado = (nuevo_estado <> 'nuevo'),
    contestado = (nuevo_estado in ('contestado', 'interesado', 'cargado')),
    cargo = (nuevo_estado = 'cargado'),
    motivo_descarte = case when nuevo_estado = 'descartado' then motivo else null end,
    ultimo_evento_resumen = format('%s marcó "%s" el %s', emp.nombre, nuevo_estado, to_char(now(), 'DD/MM HH24:MI'))
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'estado:' || nuevo_estado, case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_set_nota(input_token uuid, target_id uuid, nueva_nota text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set notas = nueva_nota
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, 'nota', jsonb_build_object('nota', nueva_nota));
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_toggle_pausado(input_token uuid, target_id uuid, nuevo_pausado boolean, motivo text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record; c record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;

  update contacts set
    pausado = nuevo_pausado,
    motivo_pausa = case when nuevo_pausado then motivo else null end
  where id = target_id and asignado_a = emp.nombre
  returning * into c;

  if c.id is not null then
    insert into contact_events (base_id, contact_id, empleado, accion, detalle)
    values (c.base_id, c.id, emp.nombre, case when nuevo_pausado then 'pausado' else 'despausado' end,
      case when motivo is not null then jsonb_build_object('motivo', motivo) else '{}'::jsonb end);
  end if;
  return c.id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_turno_abierto_actual(input_token uuid)
 RETURNS SETOF shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'abierto' and archivado = false
  order by created_at desc limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_ultimo_cierre_arrastre(input_token uuid)
 RETURNS SETOF shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query
  select * from shifts
  where status = 'cerrado' and archivado = false
    and cerrado_at is not null
    and excluir_arrastre is not true
  order by cerrado_at desc nulls last limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_urgent_queue(input_token uuid)
 RETURNS SETOF contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return; end if;

  return query select * from contacts
    where estado in ('contestado', 'interesado')
      and estado_actualizado_at is not null
      and estado_actualizado_at < now() - interval '2 hours'
    order by estado_actualizado_at asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.session_valid(input_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from sessions where token = input_token and expires_at > now());
$function$;

CREATE OR REPLACE FUNCTION public.tiene_refuerzo_abierto(input_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp record;
begin
  select * into emp from session_employee(input_token);
  if emp.id is null then return false; end if;
  return exists (select 1 from refuerzo_sessions where empleado = emp.nombre and fin is null);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_admin_pin(input_pin text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select exists (
    select 1 from app_settings
    where key = 'admin_pin_hash' and value = extensions.crypt(input_pin, value)
  );
$function$;

CREATE OR REPLACE FUNCTION public.verify_employee_pin(input_pin text)
 RETURNS TABLE(id uuid, nombre text, token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare emp record; new_token uuid; intentos_recientes int;
begin
  delete from sessions where expires_at < now();
  delete from login_attempts where created_at < now() - interval '1 hour';

  select count(*) into intentos_recientes from login_attempts
  where tipo = 'empleado' and created_at > now() - interval '5 minutes';

  if intentos_recientes >= 15 then
    perform pg_sleep(1);
    return;
  end if;

  select e.id, e.nombre into emp from employees e
  where e.activo = true and e.pin_hash = extensions.crypt(input_pin, e.pin_hash)
  limit 1;

  if emp.id is null then
    insert into login_attempts (tipo) values ('empleado');
    perform pg_sleep(0.3);
    return;
  end if;

  delete from sessions where empleado_id = emp.id;
  update refuerzo_sessions set fin = now() where empleado = emp.nombre and fin is null;
  insert into access_log (tipo, nombre) values ('empleado', emp.nombre);

  insert into sessions (empleado_id) values (emp.id) returning sessions.token into new_token;
  return query select emp.id, emp.nombre, new_token;
end;
$function$;

-- Event trigger inferido (ver nota arriba de rls_auto_enable) — comentado a
-- propósito: descomentar solo si se confirma que así estaba armado en la
-- base real. Mientras tanto, cada CREATE TABLE de este mismo archivo ya
-- tiene su `alter table ... enable row level security` explícito más
-- arriba, así que no hace falta para que ESTE script funcione.
-- create event trigger rls_auto_enable_trigger
--   on ddl_command_end
--   when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
--   execute function rls_auto_enable();

-- Revocar ejecución pública de las 2 funciones internas que no validan auth
-- por sí mismas (solo deben llamarse desde adentro de otra función security
-- definer) — ver migrations/2026-10-10-auditoria2-revocar-funciones-internas.sql.
revoke execute on function is_refuerzo_now(text) from anon, authenticated;
revoke execute on function empleado_pin_en_uso(text, uuid) from anon, authenticated;

-- ============================================================
-- DATOS INICIALES
-- ============================================================

-- PIN de Admin — CAMBIAR apenas se levante el proyecto nuevo. El de acá
-- abajo es un placeholder ("0000"), no el real de producción (ese nunca se
-- expone en texto plano, ni siquiera a Claude).
insert into app_settings (key, value) values
  ('admin_pin_hash', crypt('0000', gen_salt('bf')));

insert into app_config (key, value) values
  ('cupo_diario_leads', '35'),        -- leads activos simultáneos por empleado (no es un tope total del día: se liberan lugares a medida que resuelve)
  ('cupo_refuerzo_leads', '75'),      -- ídem, pero para alguien trabajando como refuerzo
  ('porcentaje_relleno', '15'),       -- % del cupo que se llena primero con leads de fuente "masiva"
  ('horas_reciclar_contactado', '18'),-- horas sin avance en "contactado" antes de reciclar (reemplazó a dias_reciclar_contactado)
  ('horas_reciclar_contestado', '24'),-- horas sin avance en "contestado"/"interesado" antes de reciclar
  ('max_reciclados', '6'),            -- reciclados antes de descartar automáticamente en vez de mandar a para_retomar de nuevo
  ('dias_aviso_bajo_rendimiento', '5'),-- días con una base activa y conversión ~0 antes de avisar en Admin
  ('clientes_desde', '');             -- fecha de reinicio del ranking de clientes (vacío = cuenta todo el historial)

-- Empleados de ejemplo — PINs de 4 dígitos, cambiar antes de usar en serio.
-- (admin_add_employee/admin_update_employee ya hashean, pero para la carga
-- inicial se hashea acá directo con el mismo esquema bcrypt.)
insert into employees (nombre, pin_hash) values
  ('J', crypt('1111', gen_salt('bf'))),
  ('B', crypt('2222', gen_salt('bf'))),
  ('E', crypt('3333', gen_salt('bf'))),
  ('O', crypt('4444', gen_salt('bf'))),
  ('A', crypt('5555', gen_salt('bf')));

insert into wallets (nombre, orden) values
  ('Dolapp',1),('Naranja X',2),('Mercado Pago',3),('Uala',4),('Prex',5),('Brubank',6),
  ('Personal Pay',7),('Lemon',8),('Reba',9),('MODO',10),('Cuenta DNI',11),('Belo',12),
  ('Ripio',13),('Astropay',14),('BNA+',15),('Openbank',16);

-- ============================================================
-- NOTAS Y DRIFT DETECTADO (2026-11-04)
-- ============================================================
--
-- 1. BUG ACTIVO EN PRODUCCIÓN AHORA MISMO: el volcado real de funciones
--    (pg_get_functiondef) que se usó para armar este archivo trae DOS
--    versiones de admin_importar_ganamos_operaciones al mismo tiempo:
--      - (text, uuid, jsonb) → returns int   [vieja, sin saldo real ni G_real]
--      - (text, uuid, jsonb, text) → returns text[]   [la buena, con G_real]
--    migrations/2026-11-05-ganamos-fix-funciones-duplicadas.sql existe en el
--    repo y debería haber dejado una sola versión — pero la base real
--    todavía tiene las dos, lo que significa que esa migración no se llegó
--    a correr (o se revirtió sin querer con una corrida posterior de
--    2026-11-05-ganamos-fix-concurrencia.sql, que vuelve a crear la versión
--    de 3 parámetros). HAY QUE CORRER ESTO EN LA BASE REAL DE PRODUCCIÓN
--    (no solo en una base nueva) antes de seguir usando el importador de
--    Ganamos, si no ya se corrigió:
--      drop function if exists admin_importar_ganamos_operaciones(text, uuid, jsonb);
--    (dejando solo la de 4 parámetros, que ya es la que usa el código actual).
--
-- 2. CUATRO TABLAS NUNCA TUVIERON UNA MIGRACIÓN CON SU CREATE TABLE —
--    se crearon directo en Supabase en algún momento, antes de que
--    empezara la convención de guardar todo en migrations/. Se
--    reconstruyeron en este archivo por INFERENCIA, leyendo cómo las usan
--    las funciones reales (ver comentario "INFERIDA" en cada una):
--      - sessions (empleado_id, token, created_at, expires_at)
--      - refuerzo_sessions (empleado, inicio, fin)
--      - access_log (tipo, nombre, created_at)
--      - app_settings (key, value) — esta es la más sensible: guarda el
--        hash del PIN de Admin.
--    Los tipos, nombres de columna y defaults de estas 4 son razonablemente
--    confiables (se derivan directo del cuerpo de las funciones, que sí es
--    100% real), pero constraints extra, índices, o columnas que ninguna
--    función toque nunca (y por lo tanto no se puedan inferir) podrían
--    faltar. Si hace falta una reproducción exacta al 100%, la única forma
--    es un dump real de estas 4 tablas específicas desde Supabase
--    (Database → Backups, o `pg_dump --schema-only` con la connection
--    string del proyecto — eso si ya requiere acceso directo a la base,
--    que este entorno no tiene).
--
-- 3. rls_auto_enable existe como función en la base real, pensada para
--    conectarse a un EVENT TRIGGER que le dé RLS automático a cualquier
--    tabla nueva — pero el dump de funciones no prueba que ese event
--    trigger exista de verdad hoy (los event triggers no salieron en el
--    volcado que se pidió). Se la incluye tal cual, con el `create event
--    trigger` correspondiente comentado como inferencia — no hace falta
--    para que este script funcione (cada tabla ya tiene su RLS habilitado
--    a mano más arriba).
--
-- 4. Lo que NO se pudo verificar en este entorno y conviene chequear antes
--    de confiar del todo en este archivo para un proyecto que vaya a
--    producción de verdad:
--      - Tipos exactos de columnas (int vs bigint, timestamptz vs timestamp,
--        etc.) en las 4 tablas inferidas del punto 2.
--      - Si hay algún índice adicional en producción que ninguna función
--        necesite (y por lo tanto no se pueda inferir desde acá).
--      - El tiempo real de expiración de `sessions.expires_at` (se puso
--        12 horas como valor razonable, no confirmado).
--      - Si la columna `shifts.mensajes_enviados` (heredada del primer
--        bootstrap, sin uso activo hoy) sigue existiendo en producción o
--        ya se borró en algún momento no documentado.
--    Para cerrar esto del todo, la vía más confiable sigue siendo correr
--    las 4 consultas de introspección (columnas/constraints/índices/RLS)
--    directo en el SQL Editor de Supabase y pasar el resultado — eso da
--    certeza total en vez de inferencia.
