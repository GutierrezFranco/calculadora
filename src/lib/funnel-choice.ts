import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTemplates } from "@/lib/data";

export interface FunnelOption {
  value: string;
  label: string;
}

/**
 * Opciones para "¿Por qué embudo llegó?": los embudos activos y las plantillas sin activar
 * ("t:<clave>"), que se activan solas al elegirlas. Vacío = Sin atribuir.
 */
export async function funnelOptions(supabase: SupabaseClient, businessId: string): Promise<FunnelOption[]> {
  const [{ data: funnels }, templates] = await Promise.all([
    supabase.from("funnels").select("id, name, template_key").eq("business_id", businessId).eq("status", "activo").order("created_at"),
    loadTemplates(supabase),
  ]);
  const used = new Set((funnels ?? []).map((f) => f.template_key));
  return [
    ...(funnels ?? []).map((f) => ({ value: f.id as string, label: f.name as string })),
    ...templates.filter((t) => !used.has(t.key)).map((t) => ({ value: `t:${t.key}`, label: `${t.name} (activar)` })),
  ];
}

/** Id del embudo elegido; activa la plantilla si hace falta. null = Sin atribuir. */
export async function resolveFunnel(supabase: SupabaseClient, businessId: string, value: FormDataEntryValue | null): Promise<string | null> {
  const choice = typeof value === "string" ? value : "";
  if (!choice) return null;
  if (!choice.startsWith("t:")) {
    if (!/^[0-9a-f-]{36}$/.test(choice)) throw new Error("Embudo inválido");
    return choice;
  }
  const template = choice.slice(2);
  const { data: existing } = await supabase.from("funnels").select("id").eq("business_id", businessId).eq("template_key", template).maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await supabase.rpc("crear_embudo", { p_business: businessId, p_template: template });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Los cuatro orígenes de siempre: aparecen aunque el alumno todavía no los haya activado. */
export const MAIN_TEMPLATES = ["recomendaciones", "meta_perfil", "meta_whatsapp", "meta_instagram"];

/**
 * Opciones para la carga simple: los embudos activos del negocio y, si faltan, los cuatro de siempre
 * (se activan solos al elegirlos). Sin las plantillas poco usadas, para que la lista sea corta.
 */
export async function simpleFunnelOptions(supabase: SupabaseClient, businessId: string): Promise<FunnelOption[]> {
  const [{ data: funnels }, templates] = await Promise.all([
    supabase.from("funnels").select("id, name, template_key").eq("business_id", businessId).eq("status", "activo").order("created_at"),
    loadTemplates(supabase),
  ]);
  const used = new Set((funnels ?? []).map((f) => f.template_key));
  const missing = MAIN_TEMPLATES.map((k) => templates.find((t) => t.key === k)).filter((t) => t && !used.has(t.key));
  return [
    ...(funnels ?? []).map((f) => ({ value: f.id as string, label: f.name as string })),
    ...missing.map((t) => ({ value: `t:${t!.key}`, label: t!.name })),
  ];
}
