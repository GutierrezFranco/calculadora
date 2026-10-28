"use server";

import { resolveFunnel } from "@/lib/funnel-choice";
import { createClient } from "@/lib/supabase/server";
import { saveOperation, type OperationResult } from "../operaciones/actions";

/**
 * Carga simple de reparación o venta. Arma lo que la carga completa necesita:
 * - el origen elegido (si es uno de los de siempre todavía sin activar, lo activa),
 * - en una reparación lo cobrado es también el precio (no se pide dos veces).
 */
export async function saveSimpleOperation(businessId: string, form: FormData): Promise<OperationResult> {
  try {
    const supabase = await createClient();
    form.set("funnel", (await resolveFunnel(supabase, businessId, form.get("funnel"))) ?? "");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (form.get("kind") === "reparacion") form.set("price", String(form.get("paid") ?? ""));
  if (!form.get("work")) form.set("work", "sin_dato");
  return saveOperation(businessId, form);
}
