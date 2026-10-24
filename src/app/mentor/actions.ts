"use server";

import { revalidatePath } from "next/cache";
import { requireMentor } from "@/lib/auth";
import { parseAmount } from "@/lib/format";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

/** Crea la cuenta del alumno con una contraseña inicial y su negocio. */
export async function createStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireMentor();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const businessName = String(formData.get("businessName") ?? "").trim();
  const currency = String(formData.get("currency") ?? "ARS").trim().toUpperCase();
  const timezone = String(formData.get("timezone") ?? "America/Argentina/Buenos_Aires");
  const usdRate = parseAmount(formData.get("usdRate"));

  if (!email || !businessName) return { ok: false, message: "Completá el email y el nombre del negocio" };
  if (password.length < 8) return { ok: false, message: "La contraseña inicial tiene que tener al menos 8 caracteres" };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "La moneda va en código de 3 letras (ARS, CLP, USD…)" };

  const admin = createAdminClient();
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || null },
  });
  if (userError || !created.user) {
    return { ok: false, message: `No se pudo crear la cuenta: ${userError?.message ?? "error desconocido"}` };
  }

  // El negocio se crea con la sesión del mentor, así queda su nombre en la auditoría.
  const supabase = await createClient();
  const businessId = crypto.randomUUID();
  const { error: businessError } = await supabase.from("businesses").insert({
    id: businessId,
    name: businessName,
    currency,
    timezone,
    usd_rate: usdRate === null ? null : usdRate / 100,
  });
  const { error: memberError } = businessError
    ? { error: businessError }
    : await supabase.from("memberships").insert({ business_id: businessId, user_id: created.user.id });
  if (memberError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: `No se pudo crear el negocio: ${memberError.message}` };
  }

  revalidatePath("/mentor");
  return { ok: true, message: `Listo: ${email} ya puede ingresar con la contraseña que le pusiste.` };
}

export async function setActive(businessId: string, active: boolean) {
  await requireMentor();
  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update({ active }).eq("id", businessId);
  if (error) throw new Error(error.message);
  revalidatePath("/mentor");
}

/** El mentor le pone una contraseña nueva al alumno (por ejemplo, si se la olvidó). */
export async function resetStudentPassword(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireMentor();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { ok: false, message: "Al menos 8 caracteres" };
  const supabase = await createClient();
  const { data: members } = await supabase.from("memberships").select("user_id").eq("business_id", businessId);
  if (!members || members.length === 0) return { ok: false, message: "Este negocio no tiene cuenta de alumno" };
  const admin = createAdminClient();
  for (const m of members) {
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password });
    if (error) return { ok: false, message: error.message };
  }
  return { ok: true, message: "Contraseña cambiada: pasásela al alumno" };
}
