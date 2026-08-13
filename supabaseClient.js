import { createClient } from "@supabase/supabase-js";

// Estas dos claves son PÚBLICAS a propósito (la "anon key" está pensada
// para vivir en el código del frontend). La seguridad de verdad la dan
// las políticas de RLS configuradas en Supabase, no que esto esté oculto.
const SUPABASE_URL = "https://hihmpfnxyqosyytizwct.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_peJAEX07ov3Q6FFlWPySdw__xrapVsP";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
