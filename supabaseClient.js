import { createClient } from "@supabase/supabase-js";

// Estas dos claves son PÚBLICAS a propósito (la "anon key" está pensada
// para vivir en el código del frontend). La seguridad de verdad la dan
// las políticas de RLS configuradas en Supabase, no que esto esté oculto.
//
// Se leen de variables de entorno (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
// para que el mismo código se pueda desplegar en otra oficina con su propio
// Supabase, sin tener que tocar nada acá — solo configurar esas 2 variables
// en el proyecto de Vercel de esa oficina. Si no están seteadas, usa las de
// esta oficina (la que ya está en producción) como valor por defecto.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://hihmpfnxyqosyytizwct.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_peJAEX07ov3Q6FFlWPySdw__xrapVsP";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
