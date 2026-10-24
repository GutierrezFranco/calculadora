"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getBusiness } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

export async function updateContact(businessId: string, contactId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({
      name: String(formData.get("name") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", contactId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: "Contacto guardado" };
}

export async function addPhone(businessId: string, contactId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) return { ok: false, message: "No tenés acceso a este negocio" };
  const phone = normalizePhone(String(formData.get("phone") ?? ""), business.timezone);
  if (!phone) return { ok: false, message: "El teléfono no parece válido" };
  const { error } = await supabase.from("contact_phones").insert({ business_id: businessId, contact_id: contactId, phone_e164: phone });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Ese teléfono ya es de otro contacto: si es la misma persona, fusionalos" : error.message };
  }
  revalidatePath(`/negocio/${businessId}/contactos/${contactId}`);
  return { ok: true, message: "Teléfono agregado" };
}

/** Fusiona `removeId` dentro de `keepId`: todo pasa al contacto que se conserva. */
export async function mergeContacts(businessId: string, keepId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const removeId = String(formData.get("remove") ?? "");
  if (!removeId) return { ok: false, message: "Elegí el contacto duplicado" };
  if (formData.get("confirm") !== "on") return { ok: false, message: "Confirmá que son la misma persona" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fusionar_contactos", { p_keep: keepId, p_remove: removeId });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  redirect(`/negocio/${businessId}/contactos/${keepId}?fusionado=1`);
}
