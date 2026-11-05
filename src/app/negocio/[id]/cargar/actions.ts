"use server";

import { revalidatePath } from "next/cache";
import { parseAmountText } from "@/domain/money";
import { resolveFunnel } from "@/lib/funnel-choice";
import { createClient } from "@/lib/supabase/server";
import { saveOperation, type OperationResult } from "../operaciones/actions";

/**
 * Carga simple de reparación o venta. Arma lo que la carga completa necesita:
 * - el origen elegido (si es uno de los de siempre todavía sin activar, lo activa),
 * - en una reparación lo cobrado es también el precio (no se pide dos veces),
 * - plan canje: el equipo recibido en parte de pago se registra después de guardar la venta,
 *   y si se vende un equipo de canje, su costo es lo que valía al tomarlo.
 */
export async function saveSimpleOperation(businessId: string, form: FormData): Promise<OperationResult> {
  const supabase = await createClient();
  try {
    form.set("funnel", (await resolveFunnel(supabase, businessId, form.get("funnel"))) ?? "");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (form.get("kind") === "reparacion") form.set("price", String(form.get("paid") ?? ""));
  if (!form.get("work")) form.set("work", "sin_dato");

  const isSale = form.get("kind") === "venta";
  const tradeDesc = String(form.get("tradeDesc") ?? "").trim();
  const tradeText = String(form.get("tradeValue") ?? "").trim();
  const tradeValue = tradeText ? parseAmountText(tradeText) : null;
  const soldTradeIn = isSale ? String(form.get("soldTradeIn") ?? "") : "";
  if (isSale && (tradeDesc || tradeText)) {
    if (!tradeDesc || !tradeValue) return { ok: false, message: "Del equipo que recibiste, poné qué equipo es y en cuánto lo tomaste" };
    const price = parseAmountText(String(form.get("price") ?? ""));
    const paid = parseAmountText(String(form.get("paid") ?? "")) ?? 0;
    if (!price) return { ok: false, message: "Con plan canje, poné el precio completo de la venta" };
    if (paid + tradeValue > price) return { ok: false, message: "Lo cobrado más el equipo supera el precio de la venta" };
  }
  if (soldTradeIn && !/^[0-9a-f-]{36}$/.test(soldTradeIn)) return { ok: false, message: "Equipo de canje inválido" };

  const result = await saveOperation(businessId, form);
  if (!result.ok || !result.id || !isSale) return result;
  if (tradeDesc && tradeValue) {
    const { error } = await supabase.rpc("registrar_canje", { p_business: businessId, p_operation: result.id, p_description: tradeDesc, p_value: tradeValue });
    if (error) return { ...result, ok: false, message: `La venta se guardó, pero el equipo de canje no: ${error.message}. Revisalo en Mis trabajos.` };
  }
  if (soldTradeIn) {
    const { error } = await supabase.rpc("vender_canje", { p_business: businessId, p_trade_in: soldTradeIn, p_operation: result.id });
    if (error) return { ...result, ok: false, message: `La venta se guardó, pero no se marcó el equipo de canje: ${error.message}.` };
  }
  revalidatePath(`/negocio/${businessId}`, "layout");
  return result;
}
