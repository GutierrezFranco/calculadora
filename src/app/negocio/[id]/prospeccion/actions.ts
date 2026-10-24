"use server";

import { revalidatePath } from "next/cache";
import { getBusiness } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

const STATUSES = ["no_contactado", "contactado", "respondio", "interesado", "descartado"];

export async function addProspect(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) return { ok: false, message: "No tenés acceso a este negocio" };
  const text = (name: string) => String(formData.get(name) ?? "").trim() || null;
  const rawPhone = text("phone");
  const phone = rawPhone ? normalizePhone(rawPhone, business.timezone) : null;
  if (rawPhone && !phone) return { ok: false, message: "El teléfono no parece válido" };
  if (!text("name") && !text("company") && !phone) return { ok: false, message: "Poné al menos el nombre, el negocio o el teléfono" };
  const { error } = await supabase.from("prospects").insert({
    business_id: businessId,
    name: text("name"),
    company: text("company"),
    phone_e164: phone,
    city: text("city"),
    data_origin: text("origin") ?? "Carga manual",
  });
  if (error) return { ok: false, message: error.code === "23505" ? "Ya hay un prospecto con ese teléfono" : error.message };
  revalidatePath(`/negocio/${businessId}/prospeccion`);
  return { ok: true, message: "Prospecto agregado" };
}

export async function setProspectStatus(businessId: string, prospectId: string, formData: FormData): Promise<void> {
  const status = String(formData.get("status") ?? "");
  if (!STATUSES.includes(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cambiar_estado_prospecto", { p_prospect: prospectId, p_status: status });
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}/prospeccion`);
}

export async function convertProspect(businessId: string, prospectId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("convertir_prospecto", {
    p_prospect: prospectId,
    p_need: String(formData.get("need") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}
