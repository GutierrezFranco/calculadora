import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

/** Cliente con la sesión del usuario: las políticas de acceso de la base se aplican. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // En un Server Component no se pueden escribir cookies; el proxy renueva la sesión.
        }
      },
    },
  });
}

/**
 * Cliente con la clave secreta: saltea las políticas de acceso. Solo para crear
 * cuentas de alumnos desde el panel del mentor, después de verificar que es mentor.
 */
export function createAdminClient() {
  return createSupabaseClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
