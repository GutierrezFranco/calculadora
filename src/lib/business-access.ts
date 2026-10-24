import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { getBusiness, type BusinessRow } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

/**
 * Negocio de la URL, si el usuario puede verlo. Las políticas de la base son las que
 * deciden: si no tiene acceso, el negocio simplemente no aparece y se responde 404.
 */
export async function getBusinessForUser(
  id: string,
  resource: string,
): Promise<{ user: CurrentUser; business: BusinessRow; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const user = await getCurrentUser();
  const supabase = await createClient();
  const business = await getBusiness(supabase, id);
  if (!business) notFound();
  if (user.isMentor) {
    // Cada vez que el mentor abre un negocio queda registrado.
    await supabase.rpc("registrar_acceso_mentor", { target: id, resource });
  }
  return { user, business, supabase };
}
