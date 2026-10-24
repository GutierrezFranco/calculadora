"use server";

import { revalidatePath } from "next/cache";
import { instantAt, localDate } from "@/domain/dates";
import { validLocalDate } from "@/domain/operations";
import { parseAmountText } from "@/domain/money";
import { getBusiness } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export interface CustomerOption { id: string; name: string | null; phones: string[] }
export interface OperationResult { ok: boolean; message: string; id?: string; customer?: CustomerOption }

async function context(businessId: string) {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) throw new Error("No tenés acceso a este negocio");
  return { supabase, business };
}

export async function searchCustomers(businessId: string, query: string): Promise<CustomerOption[]> {
  const { supabase, business } = await context(businessId);
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];
  const safe = term.replace(/[^\p{L}\p{N} +.-]/gu, " ");
  const digits = term.replace(/\D/g, "");
  const phone = normalizePhone(term, business.timezone);
  const { data: phones } = digits.length >= 4
    ? await supabase.from("contact_phones").select("contact_id").eq("business_id", businessId)
      .like("phone_e164", phone ? `%${digits.slice(-8)}%` : `%${digits}%`).limit(30)
    : { data: [] };
  const ids = (phones ?? []).map((p) => p.contact_id);
  let q = supabase.from("contacts").select("id, name, contact_phones(phone_e164)")
    .eq("business_id", businessId).is("merged_into", null);
  q = ids.length ? q.or(`name.ilike.%${safe}%,id.in.(${ids.join(",")})`) : q.ilike("name", `%${safe}%`);
  const { data, error } = await q.order("name").limit(30);
  if (error) throw new Error("No se pudieron buscar clientes");
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, phones: c.contact_phones.map((p: { phone_e164: string }) => p.phone_e164) }));
}

export async function customerInquiries(businessId: string, contactId: string) {
  const { supabase } = await context(businessId);
  const { data, error } = await supabase.from("opportunities").select("id, need, created_at")
    .eq("business_id", businessId).eq("contact_id", contactId).eq("entry_kind", "consulta")
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error("No se pudieron leer las consultas");
  return data ?? [];
}

export async function saveOperation(businessId: string, form: FormData): Promise<OperationResult> {
  const { supabase, business } = await context(businessId);
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const money = (name: string) => value(name) === "" ? null : parseAmountText(value(name));
  const today = localDate(new Date().toISOString(), business.timezone);
  for (const name of ["date", "paidDate"]) {
    if (value(name) && !validLocalDate(value(name), today)) return { ok: false, message: "Revisá las fechas: deben ser válidas y no futuras" };
  }
  for (const name of ["price", "paid", "cost"]) {
    if (value(name) && money(name) === null) return { ok: false, message: "Revisá los importes; dejá vacío lo que no sabés" };
  }
  const phone = normalizePhone(value("phone"), business.timezone);
  if (value("phone") && !phone) return { ok: false, message: "El WhatsApp no parece válido; agregá el prefijo internacional" };
  const { data, error } = await supabase.rpc("guardar_operacion", {
    p_business: businessId, p_id: value("id") || null, p_version: Number(value("version") || 0),
    p_data: {
      request_id: value("requestId"), contact_id: value("contactId") || null, name: value("name"), phone,
      description: value("description"), kind: value("kind"), brand: value("brand"), model: value("model"),
      reference: value("reference"), commercial_status: value("commercial"), work_status: value("work"),
      agreed_amount: money("price"), paid: money("paid"), direct_cost: money("cost"), currency: value("currency") || business.currency,
      occurred_at: value("date") ? instantAt(value("date"), 12, business.timezone) : null,
      paid_at: value("paidDate") ? instantAt(value("paidDate"), 12, business.timezone) : null,
      opportunity_id: value("inquiry") || null, funnel_id: value("funnel") || null,
      distinct_client: value("distinctClient") === "on", distinct_operation: value("distinctOperation") === "on",
      reason: value("reason"), refund: value("refund") === "on",
    },
  });
  if (error) return { ok: false, message: error.code === "23505" ? "Esa referencia ya está cargada. Revisá Operaciones antes de repetirla." : error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  const { data: operation } = await supabase.from("operations").select("contact_id").eq("business_id", businessId).eq("id", data).single();
  const { data: customer } = await supabase.from("contacts").select("id, name, contact_phones(phone_e164)").eq("business_id", businessId).eq("id", operation?.contact_id).single();
  return { ok: true, id: data as string, message: "Operación guardada", customer: customer ? { id: customer.id, name: customer.name, phones: customer.contact_phones.map((p: { phone_e164: string }) => p.phone_e164) } : undefined };
}
