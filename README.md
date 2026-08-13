# Panel Control

Aplicación web real (no un prototipo) conectada a Supabase.

## Publicarla (sin terminal, todo desde el navegador)

1. Entrá a Supabase → tu proyecto → **SQL Editor** → pegá el contenido de `schema.sql`
   → **Run**. Esto crea todas las tablas.
2. Entrá a **github.com** → creá un repositorio nuevo, vacío → **"uploading an
   existing file"** → arrastrá **todos** los archivos de esta carpeta a la vez
   (son todos sueltos, sin ninguna subcarpeta, así no hay riesgo de que se
   desordenen) → **Commit changes**.
3. Entrá a **vercel.com** → **Add New... → Project** → elegí el repositorio →
   Vercel detecta que es un proyecto Vite solo → **Deploy**.
4. En 1-2 minutos te da una URL tipo `panel-control-xxxx.vercel.app` — esa ya es
   tu página funcionando de verdad, con base de datos real.
5. (Opcional, después) Comprás un dominio y en Vercel → tu proyecto →
   **Settings → Domains** lo conectás.

No hace falta configurar ninguna variable de entorno: las claves públicas de
Supabase ya están en el código.
