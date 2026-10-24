"use server";

import { revalidatePath } from "next/cache";
import { instantAt, localDate } from "@/domain/dates";
import { getBusiness } from "@/lib/data";
import { parseAmount } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

const LEAD_SOURCES = ["organico", "meta_ads", "prospeccion", "referido", "directo", "desconocido", "otro"];

async function loadBusiness(businessId: string) {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) throw new Error("No tenés acceso a este negocio");
  return { supabase, business };
}

/** Instante para una fecha cargada: ahora si es hoy, mediodía local si es otro día. */
function whenFor(date: string, timezone: string): string {
  const now = new Date().toISOString();
  return !date || date === localDate(now, timezone) ? now : instantAt(date, 12, timezone);
}

/** Total de consultas calificadas de un día. Si ya había uno, se reemplaza. */
export async function saveTally(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await loadBusiness(businessId);
  const date = String(formData.get("date") ?? "");
  const count = Number(formData.get("count"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Elegí la fecha" };
  if (date > localDate(new Date().toISOString(), business.timezone)) {
    return { ok: false, message: "No se cargan consultas de días que todavía no pasaron" };
  }
  if (!Number.isInteger(count) || count < 0) return { ok: false, message: "La cantidad tiene que ser un número entero" };

  const { error } = await supabase
    .from("inquiry_tallies")
    .upsert(
      { business_id: businessId, date, count, method: "manual", loaded_at: new Date().toISOString() },
      { onConflict: "business_id,date,method" },
    );
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: `Guardado: ${count} consultas el ${date}` };
}

/** Venta directa ya ganada, con lo cobrado en el momento. */
export async function quickSale(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await loadBusiness(businessId);
  const amount = parseAmount(formData.get("amount"));
  if (!amount) return { ok: false, message: "Poné el monto de la venta" };
  const paidInput = formData.get("paid");
  const paid = paidInput === null || paidInput === "" ? amount : parseAmount(paidInput);
  if (paid === null || paid > amount) return { ok: false, message: "Lo cobrado no puede ser mayor que la venta" };
  const cost = parseAmount(formData.get("cost"));
  const currency = String(formData.get("currency") ?? business.currency);
  if (currency !== business.currency && currency !== "USD") return { ok: false, message: "Moneda inválida" };
  const source = String(formData.get("source") ?? "desconocido");
  if (!LEAD_SOURCES.includes(source)) return { ok: false, message: "Origen inválido" };

  const rawPhone = String(formData.get("phone") ?? "");
  const phone = normalizePhone(rawPhone, business.timezone);
  if (rawPhone.trim() && !phone) return { ok: false, message: "El teléfono no parece válido" };

  const { error } = await supabase.rpc("registrar_venta_rapida", {
    p_business: businessId,
    p_amount: amount,
    p_currency: currency,
    p_paid: paid,
    p_description: String(formData.get("description") ?? "").trim() || null,
    p_contact_name: String(formData.get("contactName") ?? "").trim() || null,
    p_phone: phone,
    p_direct_cost: cost,
    p_source: source,
    p_won_at: whenFor(String(formData.get("date") ?? ""), business.timezone),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: "Venta registrada" };
}

export async function saveSettings(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await loadBusiness(businessId);
  const name = String(formData.get("name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  const rateInput = formData.get("usdRate");
  const rate = parseAmount(rateInput);
  if (!name) return { ok: false, message: "El negocio necesita un nombre" };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "La moneda va en código de 3 letras (ARS, CLP, USD…)" };
  if (rateInput && rate === null) return { ok: false, message: "La cotización tiene que ser un número" };

  const { error } = await supabase
    .from("businesses")
    .update({
      name,
      zone: String(formData.get("zone") ?? "").trim() || null,
      currency,
      usd_rate: rate === null || rate === 0 ? null : rate / 100,
      deposits_refundable: formData.get("depositsRefundable") === "on",
    })
    .eq("id", businessId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: "Configuración guardada. Las ventas nuevas toman esta cotización." };
}

const GOAL_METRICS = ["facturacion", "ventas", "consultas"] as const;

/** Objetivos de un mes. Vacío borra el objetivo de esa métrica. */
export async function saveGoals(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await loadBusiness(businessId);
  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Elegí el mes" };
  const periodStart = `${month}-01`;

  for (const metric of GOAL_METRICS) {
    const raw = formData.get(metric);
    const target = metric === "facturacion" ? parseAmount(raw) : raw ? Number(raw) : null;
    if (raw && (target === null || !Number.isInteger(target) || target < 0)) {
      return { ok: false, message: "Los objetivos tienen que ser números positivos" };
    }
    const where = { business_id: businessId, metric, period_kind: "mensual", period_start: periodStart };
    const { error } = target
      ? await supabase.from("goals").upsert(
          { ...where, target, currency: metric === "facturacion" ? business.currency : null },
          { onConflict: "business_id,metric,period_kind,period_start" },
        )
      : await supabase.from("goals").delete().match(where);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: "Objetivos guardados" };
}
