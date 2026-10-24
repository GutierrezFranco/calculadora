"use server";

import { revalidatePath } from "next/cache";
import type { Assumption, ProjectionInputs } from "@/domain/projection";
import { parseAmountText } from "@/domain/money";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

/** Monto del formulario en centavos. */
const money = (v: FormDataEntryValue | null) => (typeof v === "string" ? parseAmountText(v) : null);
/** Porcentaje del formulario ("25" o "2,5") como proporción (0,25 o 0,025). */
const percent = (v: FormDataEntryValue | null) => {
  const cents = money(v);
  return cents === null ? null : cents / 10_000;
};

/** Un supuesto es "real" si coincide con el dato real que se le mostró al alumno. */
function assumption(value: number | null, realRaw: FormDataEntryValue | null): Assumption {
  const real = typeof realRaw === "string" && realRaw !== "" ? Number(realRaw) : null;
  const same = value !== null && real !== null && Math.abs(value - real) <= Math.max(Math.abs(real) * 0.005, 1e-9);
  return { value, origin: same ? "real" : "estimado" };
}

export async function saveScenario(businessId: string, kind: "principal" | "alternativo", _prev: FormState, formData: FormData): Promise<FormState> {
  const goal = money(formData.get("goal"));
  if (!goal) return { ok: false, message: "Poné la meta del mes" };
  const goalKind = formData.get("goalKind") === "contribucion" ? "contribucion" : "facturacion";
  const field = (name: string, parse: (v: FormDataEntryValue | null) => number | null) =>
    assumption(parse(formData.get(name)), formData.get(`real_${name}`));
  const inputs: ProjectionInputs = {
    goalKind,
    goal,
    ticket: field("ticket", money),
    closeRate: field("closeRate", percent),
    margin: field("margin", percent),
    paidShare: field("paidShare", percent),
    costPerInquiry: field("costPerInquiry", money),
    inquiriesPerVisit: field("inquiriesPerVisit", percent),
    prospectShare: field("prospectShare", percent),
    prospectConversion: field("prospectConversion", percent),
  };
  for (const [name, a] of Object.entries(inputs)) {
    if (typeof a === "object" && a.value !== null && (a.value < 0 || (name !== "ticket" && name !== "costPerInquiry" && a.value > 1))) {
      return { ok: false, message: "Revisá los porcentajes: van de 0 a 100" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("projection_scenarios").upsert(
    {
      business_id: businessId,
      kind,
      name: kind === "principal" ? "Escenario principal" : "Escenario alternativo",
      inputs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id,kind" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}/proyeccion`);
  return { ok: true, message: "Escenario guardado" };
}
