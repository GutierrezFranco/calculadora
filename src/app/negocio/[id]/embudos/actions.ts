"use server";

import { revalidatePath } from "next/cache";
import { localDate } from "@/domain/dates";
import type { FunnelStepDef } from "@/domain/types";
import { getBusiness } from "@/lib/data";
import { parseAmount } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

async function client(businessId: string) {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) throw new Error("No tenés acceso a este negocio");
  return { supabase, business };
}

const done = (businessId: string, message: string): FormState => {
  revalidatePath(`/negocio/${businessId}`, "layout");
  revalidatePath(`/mentor`, "layout");
  return { ok: true, message };
};

export async function activateTemplate(businessId: string, template: string): Promise<void> {
  const { supabase } = await client(businessId);
  const { error } = await supabase.rpc("crear_embudo", { p_business: businessId, p_template: template });
  if (error) throw new Error(error.message.includes("duplicate") ? "Ese embudo ya está activo" : error.message);
  done(businessId, "");
}

export async function setFunnelStatus(businessId: string, funnelId: string, status: string): Promise<void> {
  const { supabase } = await client(businessId);
  const { error } = await supabase.rpc("cambiar_estado_embudo", { p_funnel: funnelId, p_status: status });
  if (error) throw new Error(error.message);
  done(businessId, "");
}

/** Registro de actividad: cada paso de la versión vigente es un campo `paso:<clave>`. */
export async function registerActivity(businessId: string, funnelId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, business } = await client(businessId);
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Elegí la fecha" };
  if (date > localDate(new Date().toISOString(), business.timezone)) return { ok: false, message: "La fecha no puede ser futura" };
  const values: Record<string, number> = {};
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("paso:") || raw === "") continue;
    const unit = formData.get(`unidad:${key.slice(5)}`);
    const value = unit === "dinero" ? parseAmount(raw) : Number(String(raw).replace(/\./g, "").replace(",", "."));
    if (value === null || !Number.isFinite(value) || value < 0) return { ok: false, message: "Los valores tienen que ser números positivos" };
    values[key.slice(5)] = value;
  }
  if (Object.keys(values).length === 0) return { ok: false, message: "Cargá al menos un valor" };
  const { error } = await supabase.rpc("registrar_actividad_embudo", {
    p_funnel: funnelId,
    p_on: date,
    p_values: values,
    p_quality: formData.get("estimado") === "on" ? "estimado" : "real",
    p_label: String(formData.get("label") ?? "").trim() || null,
  });
  if (error) return { ok: false, message: error.message };
  return done(businessId, "Actividad registrada");
}

export async function deleteActivity(businessId: string, activityId: string): Promise<void> {
  const { supabase } = await client(businessId);
  const { error } = await supabase.from("funnel_activities").delete().eq("id", activityId);
  if (error) throw new Error(error.message);
  done(businessId, "");
}

/** Pasos escritos uno por línea: "Etiqueta | unidad". La clave sale de la etiqueta. */
function parseSteps(text: string): FunnelStepDef[] | string {
  const units = ["cantidad", "personas", "horas", "dinero"] as const;
  const steps: FunnelStepDef[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [labelPart, unitPart] = line.split("|").map((p) => p.trim());
    const unit = (unitPart || "cantidad").toLowerCase() as FunnelStepDef["unit"];
    if (!units.includes(unit)) return `Unidad desconocida en "${line}": usá cantidad, personas, horas o dinero`;
    const key = labelPart
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "p_$1")
      .slice(0, 40);
    if (!key) return `Paso sin nombre: "${line}"`;
    if (steps.some((s) => s.key === key)) return `Paso repetido: "${labelPart}"`;
    steps.push({ key, label: labelPart.slice(0, 80), unit });
  }
  if (steps.length > 8) return "Hasta 8 pasos por embudo";
  return steps;
}

export async function createCustomFunnel(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await client(businessId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Poné un nombre" };
  const steps = parseSteps(String(formData.get("steps") ?? ""));
  if (typeof steps === "string") return { ok: false, message: steps };
  const { error } = await supabase.rpc("crear_embudo", {
    p_business: businessId,
    p_template: null,
    p_name: name,
    p_steps: steps,
    p_channel: String(formData.get("channel") ?? "otro"),
    p_allows_direct: formData.get("direct") === "on",
  });
  if (error) return { ok: false, message: error.message.includes("duplicate") ? "Ya hay un embudo con ese nombre" : error.message };
  return done(businessId, "Embudo creado");
}

export async function versionFunnel(businessId: string, funnelId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await client(businessId);
  const steps = parseSteps(String(formData.get("steps") ?? ""));
  if (typeof steps === "string") return { ok: false, message: steps };
  const from = String(formData.get("validFrom") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { ok: false, message: "Elegí desde qué fecha valen los pasos nuevos" };
  const { error } = await supabase.rpc("versionar_embudo", {
    p_funnel: funnelId,
    p_steps: steps,
    p_valid_from: from,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { ok: false, message: error.message };
  return done(businessId, "Versión nueva guardada: los datos anteriores conservan sus pasos");
}
