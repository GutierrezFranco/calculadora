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
    // Línea de base del antes y después: el mes en que entra al programa (se puede cambiar en su ficha).
    program_start: `${new Date().toISOString().slice(0, 7)}-01`,
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

const revalidateStudent = (businessId: string) => {
  revalidatePath(`/mentor/alumno/${businessId}`);
  revalidatePath("/mentor");
};

/** Mes de ingreso al programa: es la línea de base del antes y después. */
export async function setProgramStart(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireMentor();
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Elegí el mes" };
  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update({ program_start: `${month}-01` }).eq("id", businessId);
  if (error) return { ok: false, message: error.message };
  revalidateStudent(businessId);
  return { ok: true, message: "Mes de ingreso guardado" };
}

/** Valores declarados del mes de ingreso, cuando no hay datos cargados de ese mes. */
export async function saveBaseline(businessId: string, currency: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireMentor();
  const count = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const consultas = count("consultas");
  const clientes = count("clientes");
  const facturacion = parseAmount(formData.get("facturacion"));
  if ([consultas, clientes].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) {
    return { ok: false, message: "Consultas y clientes son números enteros" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("business_baselines").upsert({
    business_id: businessId,
    consultas,
    clientes,
    facturacion,
    currency,
    notes: String(formData.get("notes") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  revalidateStudent(businessId);
  return { ok: true, message: "Línea de base guardada como declarada" };
}

export async function addNote(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireMentor();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { ok: false, message: "Escribí la nota" };
  const supabase = await createClient();
  const { error } = await supabase.from("mentor_notes").insert({ business_id: businessId, body: body.slice(0, 4000) });
  if (error) return { ok: false, message: error.message };
  revalidateStudent(businessId);
  return { ok: true, message: "Nota guardada" };
}

export async function deleteNote(businessId: string, noteId: string): Promise<void> {
  await requireMentor();
  const supabase = await createClient();
  const { error } = await supabase.from("mentor_notes").delete().eq("id", noteId);
  if (error) throw new Error(error.message);
  revalidateStudent(businessId);
}
