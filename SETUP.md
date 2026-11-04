# Cómo levantar un panel nuevo desde cero (otra oficina)

Esta guía sirve para montar una copia completa e **independiente** del
sistema — con su propia base de datos, sus propios empleados, sus propias
billeteras — para otra oficina. El código (este repositorio) es el mismo
para todas las oficinas; lo único que cambia por oficina es la base de
Supabase a la que se conecta cada despliegue.

No hace falta tocar ni una línea de código para agregar una oficina nueva.

---

## 1. Crear el proyecto de Supabase (la base de datos)

1. Entrá a [supabase.com](https://supabase.com) y creá un proyecto nuevo
   (elegí un nombre que identifique la oficina, ej. "panel-sucursal-2").
   Guardá la contraseña de base de datos que te pida crear — no hace
   falta para esta guía, pero convendría tenerla a mano.
2. Una vez creado, andá a **SQL Editor** (menú de la izquierda) → **New
   query**.
3. Abrí el archivo [`schema.sql`](./schema.sql) de este repositorio,
   copialo entero, y pegalo ahí. Tocá **Run**.
   - Esto crea las 17 tablas, los índices, las políticas de seguridad
     (RLS) y las 75 funciones que usa la app — la base completa, vacía,
     lista para operar.
   - También crea empleados y billeteras de **ejemplo** con PINs
     predecibles (`1111`, `2222`, etc.) — son solo para poder entrar la
     primera vez. Cambialos en el paso siguiente antes de usar el sistema
     en serio.
4. Andá a **Project Settings** (ícono de engranaje) → **API**. Ahí vas a
   ver dos datos que necesitás para el paso 3 de esta guía:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon / public key** (empieza con `sb_publishable_...` o `eyJ...`
     según la versión del proyecto)

## 2. Configurar el PIN de admin y los empleados reales

Con el proyecto recién creado, **antes de usarlo en serio**:

1. En el SQL Editor, corré esto para poner el PIN de admin real de esa
   oficina (cambiá `TU_PIN_NUEVO` por el que quieras usar — mínimo 4
   dígitos, puede ser más largo):
   ```sql
   update app_settings
   set value = extensions.crypt('TU_PIN_NUEVO', extensions.gen_salt('bf'))
   where key = 'admin_pin_hash';
   ```
2. Entrá al panel (una vez desplegado, ver paso 3) con ese PIN nuevo, andá
   a **Empleados**, y:
   - Borrá o reasigná los 5 empleados de ejemplo (`J`, `B`, `E`, `O`, `A`)
     con los PINs reales de los empleados de esa oficina.
   - Revisá **Billeteras** y dejá solo las que esa oficina realmente usa
     (el schema trae una lista larga de ejemplo).

## 3. Desplegar el panel en Vercel

1. En [vercel.com](https://vercel.com), **Add New → Project**.
2. Importá este mismo repositorio de GitHub
   (`pedritoelloco10/panel-control-11`) — no hace falta forkearlo ni
   copiarlo, Vercel permite desplegar el mismo repo varias veces como
   proyectos distintos.
3. En la pantalla de configuración, antes de desplegar, abrí
   **Environment Variables** y agregá estas dos (con los valores del
   paso 1.4, del proyecto de Supabase de ESTA oficina):
   - `VITE_SUPABASE_URL` → el Project URL
   - `VITE_SUPABASE_ANON_KEY` → la anon/public key
4. Desplegá. Vercel te da un dominio tipo `panel-sucursal-2.vercel.app`
   automáticamente.
5. (Opcional) En **Settings → Domains** de ese proyecto de Vercel, podés
   agregarle un dominio propio (ej. `oficina2.panelcontrol.space` o lo que
   compres para esa oficina).

## 4. Probar que quedó bien

1. Entrá al dominio nuevo, logueate como empleado con uno de los PINs que
   configuraste, abrí un turno de prueba y cerralo.
2. Entrá como Admin con el PIN que configuraste en el paso 2.
3. Confirmá en el panel admin que el turno de prueba aparece — y que
   **no** aparece nada de la oficina original (es la prueba de que está
   conectado a su propia base, no a la de otra oficina).
4. Archivá el turno de prueba antes de arrancar en serio.

---

## Qué comparte cada oficina y qué no

| | Compartido entre oficinas | Propio de cada oficina |
|---|---|---|
| Código (este repo) | ✅ el mismo para todas | — |
| Base de datos (Supabase) | — | ✅ una por oficina, nunca se mezclan |
| Empleados, turnos, clientes, bases | — | ✅ |
| PIN de admin | — | ✅ cada oficina el suyo |
| Dominio | — | ✅ cada oficina el suyo |

Si en algún momento se necesita un cambio de código (una función nueva,
un arreglo), se hace **una sola vez acá** y todas las oficinas lo reciben
al redesplegar su propio proyecto de Vercel desde este mismo repo.

---

## Notas sobre `schema.sql`

Ver la sección "NOTAS Y DRIFT DETECTADO" al final de ese archivo — hay 4
tablas (`sessions`, `refuerzo_sessions`, `access_log`, `app_settings`) que
se reconstruyeron por inferencia (nunca tuvieron una migración propia en
este repo) y no están verificadas al 100% contra la base original. Son
confiables para levantar una oficina nueva funcional, pero si en algún
momento algo no coincide exactamente, esa es la causa más probable a
revisar primero.
