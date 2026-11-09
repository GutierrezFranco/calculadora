"use server";

import { revalidatePath } from "next/cache";
import { parseAmountText } from "@/domain/money";
import { getBusiness } from "@/lib/data";
import { resolveFunnel } from "@/lib/funnel-choice";
import { createClient } from "@/lib/supabase/server";

export type AdsState = { ok: boolean; message: string } | null;

const count = (text: string) => {
  const clean = text.trim().replace(/\./g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/**
 * Guarda la publicidad del mes: por cada embudo, inversión (en pesos o dólares), consultas y, si quiere,
 * datos del anuncio. Corregir un mes reemplaza lo cargado (un registro por embudo y mes). Vacío = no cargado,
 * nunca cero. La inversión en dólares guarda la cotización del negocio para convertirla después.
 */
export async function saveMonthAds(businessId: string, _prev: AdsState, form: FormData): Promise<AdsState> {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) return { ok: false, message: "No tenés acceso a este negocio" };
  const month = String(form.get("month") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, message: "Mes inválido" };
  const keys = form.getAll("row").map(String);
  let saved = 0;
  for (const key of keys) {
    const field = (name: string) => String(form.get(`${name}:${key}`) ?? "").trim();
    const spendText = field("spend");
    const inquiries = count(field("inq"));
    const followers = count(field("followers"));
    const plays3s = count(field("plays"));
    const impressions = count(field("impressions"));
    const currency = field("currency") === "USD" ? "USD" : business.currency;
    const empty = !spendText && [inquiries, followers, plays3s, impressions].every((v) => v === null);
    if (empty && key.startsWith("t:")) continue; // embudo sin activar y sin datos: nada que guardar
    const spend = spendText ? parseAmountText(spendText) : null;
    if (spendText && spend === null) return { ok: false, message: "Revisá la inversión: tiene que ser un número" };
    if ([inquiries, followers, plays3s, impressions].some((v) => Number.isNaN(v))) {
      return { ok: false, message: "Consultas, seguidores, reproducciones e impresiones son números enteros" };
    }
    const usdRate = currency !== business.currency ? (business.usd_rate === null ? null : Number(business.usd_rate)) : null;
    if (spend !== null && currency !== business.currency && !usdRate) {
      return { ok: false, message: "Para cargar en dólares, poné la cotización del dólar en Configuración" };
    }
    let funnelId: string | null;
    try {
      funnelId = await resolveFunnel(supabase, businessId, key);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    if (!funnelId) continue;
    if (empty) {
      // Borró todo: el mes queda sin cargar para ese embudo
      await supabase.from("funnel_months").delete().eq("business_id", businessId).eq("funnel_id", funnelId).eq("month", `${month}-01`);
      continue;
    }
    const { error } = await supabase.from("funnel_months").upsert(
      {
        business_id: businessId, funnel_id: funnelId, month: `${month}-01`, spend, inquiries, currency, usd_rate: usdRate,
        followers, plays_3s: plays3s, impressions, updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,funnel_id,month" },
    );
    if (error) return { ok: false, message: "No se pudo guardar. Probá de nuevo." };
    saved++;
  }
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: saved ? "Guardado ✓" : "No había nada para guardar" };
}

/** +1 (o −1) consulta del mes en un embudo: para contar las conversaciones durante un live. */
export async function bumpInquiry(businessId: string, key: string, month: string, delta: 1 | -1): Promise<{ ok: boolean; count?: number; message?: string }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, message: "Mes inválido" };
  const supabase = await createClient();
  let funnelId: string | null;
  try {
    funnelId = await resolveFunnel(supabase, businessId, key);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (!funnelId) return { ok: false, message: "Embudo inválido" };
  const { data, error } = await supabase.rpc("sumar_consulta_embudo", { p_business: businessId, p_funnel: funnelId, p_month: `${month}-01`, p_delta: delta });
  if (error) return { ok: false, message: "No se pudo sumar. Probá de nuevo." };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, count: data as number };
}
