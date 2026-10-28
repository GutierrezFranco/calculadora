"use server";

import { revalidatePath } from "next/cache";
import { parseAmountText } from "@/domain/money";
import { getBusiness } from "@/lib/data";
import { resolveFunnel } from "@/lib/funnel-choice";
import { createClient } from "@/lib/supabase/server";

export type AdsState = { ok: boolean; message: string } | null;

/**
 * Guarda la publicidad del mes: por cada embudo, inversión y consultas. Corregir un mes reemplaza lo cargado
 * (un registro por embudo y mes). Los campos vacíos quedan como "no cargado", no como cero.
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
    const spendText = String(form.get(`spend:${key}`) ?? "").trim();
    const inqText = String(form.get(`inq:${key}`) ?? "").trim().replace(/\./g, "");
    if (!spendText && !inqText && key.startsWith("t:")) continue; // embudo sin activar y sin datos: nada que guardar
    const spend = spendText ? parseAmountText(spendText) : null;
    const inquiries = inqText ? Number(inqText) : null;
    if (spendText && spend === null) return { ok: false, message: "Revisá la inversión: tiene que ser un número" };
    if (inqText && (!Number.isInteger(inquiries) || inquiries! < 0)) return { ok: false, message: "Las consultas tienen que ser un número entero" };
    let funnelId: string | null;
    try {
      funnelId = await resolveFunnel(supabase, businessId, key);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    if (!funnelId) continue;
    if (spend === null && inquiries === null) {
      // Borró los dos datos: el mes queda sin cargar para ese embudo
      await supabase.from("funnel_months").delete().eq("business_id", businessId).eq("funnel_id", funnelId).eq("month", `${month}-01`);
      continue;
    }
    const { error } = await supabase.from("funnel_months").upsert(
      { business_id: businessId, funnel_id: funnelId, month: `${month}-01`, spend, inquiries, currency: business.currency, updated_at: new Date().toISOString() },
      { onConflict: "business_id,funnel_id,month" },
    );
    if (error) return { ok: false, message: "No se pudo guardar. Probá de nuevo." };
    saved++;
  }
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: saved ? "Guardado ✓" : "No había nada para guardar" };
}
