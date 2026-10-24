"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { instantAt, localDate } from "@/domain/dates";
import { STAGES } from "@/domain/pipeline";
import { getBusiness } from "@/lib/data";
import { parseAmount } from "@/lib/format";
import { resolveFunnel } from "@/lib/funnel-choice";
import { normalizePhone } from "@/lib/phone";
import { openOpportunitiesForPhone } from "@/lib/pipeline-data";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

async function context(businessId: string) {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) throw new Error("No tenés acceso a este negocio");
  return { supabase, business };
}

function currencyFrom(formData: FormData, local: string): string | null {
  const currency = String(formData.get("currency") ?? local);
  return currency === local || currency === "USD" ? currency : null;
}

function done(businessId: string, oppId: string | null, message: string): FormState {
  revalidatePath(`/negocio/${businessId}`, "layout");
  if (oppId) revalidatePath(`/negocio/${businessId}/pipeline/${oppId}`);
  return { ok: true, message };
}

const failed = (message: string): FormState => ({ ok: false, message });

const LOST_CATEGORIES = ["precio", "sin_respuesta", "eligio_otro", "no_reparable", "otro"];

export async function createOpportunity(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await context(businessId);
  const need = String(formData.get("need") ?? "").trim();
  if (!need) return failed("Contá qué necesita el cliente");
  let funnel: string | null;
  try {
    funnel = await resolveFunnel(supabase, businessId, formData.get("funnel"));
  } catch (e) {
    return failed((e as Error).message);
  }
  const rawPhone = String(formData.get("phone") ?? "");
  const phone = normalizePhone(rawPhone, business.timezone);
  if (rawPhone.trim() && !phone) return failed("El teléfono no parece válido");

  // Regla: la misma persona escribiendo por lo mismo no es una consulta nueva.
  if (phone && formData.get("otherNeed") !== "on") {
    const open = await openOpportunitiesForPhone(supabase, businessId, phone);
    if (open.length > 0) {
      const list = open
        .map((o) => `"${o.need ?? "sin detalle"}" (${STAGES.find((s) => s.id === o.stage)?.label})`)
        .join(", ");
      return failed(
        `Este cliente ya tiene abierta: ${list}. Si es la misma consulta, seguila desde el pipeline. ` +
          `Si es una necesidad distinta, marcá "Es otra necesidad" y guardá de nuevo.`,
      );
    }
  }

  const date = String(formData.get("date") ?? "");
  const today = localDate(new Date().toISOString(), business.timezone);
  const followUp = String(formData.get("followUp") ?? "");
  const { data: oppId, error } = await supabase.rpc("crear_oportunidad", {
    p_business: businessId,
    p_need: need,
    p_contact_name: String(formData.get("contactName") ?? "").trim() || null,
    p_phone: phone,
    p_source: "desconocido",
    p_funnel: funnel,
    p_evidence: String(formData.get("evidence") ?? "").trim() || null,
    p_created_at: !date || date === today ? new Date().toISOString() : instantAt(date, 12, business.timezone),
    p_next_follow_up: followUp ? instantAt(followUp, 10, business.timezone) : null,
  });
  if (error) return failed(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
  redirect(`/negocio/${businessId}/pipeline/${oppId}`);
}

export async function moveOpportunity(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  const stage = String(formData.get("stage") ?? "");
  const { error } = await supabase.rpc("mover_oportunidad", { p_opp: oppId, p_stage: stage });
  if (error) return failed(error.message);
  return done(businessId, oppId, `Movida a ${STAGES.find((s) => s.id === stage)?.label}`);
}

export async function addQuote(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await context(businessId);
  const amount = parseAmount(formData.get("amount"));
  const currency = currencyFrom(formData, business.currency);
  if (!amount || !currency) return failed("Poné el monto del presupuesto");
  const { error } = await supabase.rpc("registrar_presupuesto", { p_opp: oppId, p_amount: amount, p_currency: currency });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Presupuesto registrado");
}

export async function addPayment(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await context(businessId);
  const amount = parseAmount(formData.get("amount"));
  const currency = currencyFrom(formData, business.currency);
  if (!amount || !currency) return failed("Poné el monto cobrado");
  const { error } = await supabase.rpc("registrar_cobro", {
    p_opp: oppId,
    p_amount: amount,
    p_currency: currency,
    p_method: String(formData.get("method") ?? "").trim() || null,
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Cobro registrado");
}

export async function winOpportunity(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await context(businessId);
  const amount = parseAmount(formData.get("amount"));
  const currency = currencyFrom(formData, business.currency);
  if (!amount || !currency) return failed("Poné el monto pactado");
  const paidInput = formData.get("paid");
  const paid = paidInput ? parseAmount(paidInput) : 0;
  if (paid === null || paid > amount) return failed("Lo cobrado no puede ser mayor que el monto pactado");
  const { error } = await supabase.rpc("ganar_oportunidad", {
    p_opp: oppId,
    p_amount: amount,
    p_currency: currency,
    p_paid: paid,
    p_direct_cost: parseAmount(formData.get("cost")),
    p_completed: formData.get("completed") === "on",
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "¡Venta ganada!");
}

export async function loseOpportunity(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  if (formData.get("confirm") !== "on") return failed("Confirmá que el cliente no sigue");
  const { error } = await supabase.rpc("perder_oportunidad", {
    p_opp: oppId,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
    p_refund_deposit: formData.get("refund") === "on",
    p_category: LOST_CATEGORIES.includes(String(formData.get("category"))) ? String(formData.get("category")) : null,
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Marcada como perdida");
}

export async function reopenOpportunity(businessId: string, oppId: string): Promise<FormState> {
  const { supabase } = await context(businessId);
  const { error } = await supabase.rpc("reabrir_oportunidad", { p_opp: oppId });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Reabierta: está en seguimiento");
}

export async function reverseSale(businessId: string, oppId: string, saleId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  if (formData.get("confirm") !== "on") return failed("Confirmá la reversión");
  const { error } = await supabase.rpc("revertir_venta", {
    p_sale: saleId,
    p_reason: String(formData.get("reason") ?? "").trim(),
    p_refund: formData.get("refund") === "on",
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Venta revertida");
}

export async function updateCost(businessId: string, oppId: string, saleId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  const cost = parseAmount(formData.get("cost"));
  if (cost === null) return failed("Poné el costo directo");
  const { error } = await supabase.from("sales").update({ direct_cost: cost }).eq("id", saleId);
  if (error) return failed(error.message);
  return done(businessId, oppId, "Costo guardado");
}

export async function updateFollowUp(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await context(businessId);
  const date = String(formData.get("followUp") ?? "");
  const { error } = await supabase
    .from("opportunities")
    .update({ next_follow_up_at: date ? instantAt(date, 10, business.timezone) : null })
    .eq("id", oppId);
  if (error) return failed(error.message);
  return done(businessId, oppId, date ? "Seguimiento agendado" : "Seguimiento borrado");
}

/** Cancelación técnica: el trabajo aceptado no se pudo hacer. No cuenta como pérdida comercial. */
export async function cancelJob(businessId: string, oppId: string, saleId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  if (formData.get("confirm") !== "on") return failed("Confirmá que el trabajo no se pudo hacer");
  const { error } = await supabase.rpc("cancelar_trabajo", {
    p_sale: saleId,
    p_reason: String(formData.get("reason") ?? "").trim(),
    p_refund: formData.get("refund") === "on",
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Cancelación técnica registrada");
}

const CONFIDENCES = ["confirmada", "declarada", "inferida"];

export async function assignFunnel(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  let funnel: string | null;
  try {
    funnel = await resolveFunnel(supabase, businessId, formData.get("funnel"));
  } catch (e) {
    return failed((e as Error).message);
  }
  const confidence = String(formData.get("confidence") ?? "declarada");
  const { error } = await supabase.rpc("asignar_embudo", {
    p_opp: oppId,
    p_funnel: funnel,
    p_confidence: CONFIDENCES.includes(confidence) ? confidence : "declarada",
    p_evidence: String(formData.get("evidence") ?? "").trim() || null,
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, funnel ? "Embudo asignado" : "Quedó Sin atribuir");
}

export async function addTouchpoint(businessId: string, oppId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await context(businessId);
  let funnel: string | null;
  try {
    funnel = await resolveFunnel(supabase, businessId, formData.get("funnel"));
  } catch (e) {
    return failed((e as Error).message);
  }
  if (!funnel) return failed("Elegí el embudo");
  const { error } = await supabase.rpc("agregar_punto_contacto", {
    p_opp: oppId,
    p_funnel: funnel,
    p_evidence: String(formData.get("evidence") ?? "").trim() || null,
  });
  if (error) return failed(error.message);
  return done(businessId, oppId, "Punto de contacto agregado");
}
