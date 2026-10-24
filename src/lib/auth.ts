import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  isMentor: boolean;
  /** Negocios activos del alumno (el mentor los ve todos desde su panel). */
  businessIds: string[];
}

/** Usuario logueado con su rol; si no hay sesión, manda al login. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("full_name, is_mentor").eq("id", claims.sub).single(),
    supabase.from("memberships").select("business_id, businesses(active)").eq("user_id", claims.sub),
  ]);

  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    fullName: profile?.full_name ?? null,
    isMentor: profile?.is_mentor ?? false,
    businessIds: (memberships ?? [])
      .filter((m) => (m.businesses as unknown as { active: boolean } | null)?.active)
      .map((m) => m.business_id as string),
  };
}

export async function requireMentor(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user.isMentor) redirect("/");
  return user;
}
