"use server";

import { revalidatePath } from "next/cache";
import { parseAmountText } from "@/domain/money";
import { getBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim() || null;
const date = (f: FormData, name: string) => {
  const v = String(f.get(name) ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
/** Entero no negativo o null si está vacío; NaN si es inválido. */
const count = (f: FormData, name: string) => {
  const v = String(f.get(name) ?? "").trim().replace(/\./g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

async function done(businessId: string, error: { message: string } | null, message: string): Promise<FormState> {
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message };
}

function invalidCounts(values: (number | null)[]): boolean {
  return values.some((v) => v !== null && Number.isNaN(v));
}

export async function addContent(businessId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const published = date(f, "published");
  if (!published) return { ok: false, message: "Poné la fecha de publicación" };
  const supabase = await createClient();
  const { error } = await supabase.from("content_items").insert({
    business_id: businessId,
    url: text(f, "url"),
    platform: text(f, "platform") ?? "instagram",
    published_on: published,
    topic: text(f, "topic"),
    angle: text(f, "angle")?.toLowerCase() ?? null,
    format: text(f, "format"),
    goal: text(f, "goal"),
  });
  return done(businessId, error, "Contenido agregado");
}

export async function addContentMetrics(businessId: string, contentId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const observed = date(f, "observed");
  if (!observed) return { ok: false, message: "Poné la fecha en que miraste las métricas" };
  const values = { views: count(f, "views"), reach: count(f, "reach"), interactions: count(f, "interactions"), saves: count(f, "saves"), shares: count(f, "shares"), comments: count(f, "comments") };
  if (invalidCounts(Object.values(values))) return { ok: false, message: "Las métricas son números enteros" };
  const retentionCents = parseAmountText(String(f.get("retention") ?? ""));
  const supabase = await createClient();
  const { error } = await supabase.from("content_metric_snapshots").insert({
    business_id: businessId,
    content_id: contentId,
    observed_on: observed,
    ...values,
    retention_pct: retentionCents === null ? null : Math.min(retentionCents / 100, 100),
  });
  return done(businessId, error, "Métricas guardadas");
}

export async function addAccountMetrics(businessId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const from = date(f, "from");
  const to = date(f, "to");
  if (!from || !to || to < from) return { ok: false, message: "Revisá el rango de fechas" };
  const values = { profile_visits: count(f, "visits"), link_clicks: count(f, "clicks"), followers: count(f, "followers"), reach: count(f, "reach") };
  if (invalidCounts(Object.values(values))) return { ok: false, message: "Las métricas son números enteros" };
  const supabase = await createClient();
  const { error } = await supabase.from("account_metric_snapshots").insert({
    business_id: businessId,
    platform: text(f, "platform") ?? "instagram",
    period_start: from,
    period_end: to,
    ...values,
  });
  return done(businessId, error, "Métricas de la cuenta guardadas");
}

export async function addCampaign(businessId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const name = text(f, "name");
  if (!name) return { ok: false, message: "Poné un nombre para la campaña" };
  const supabase = await createClient();
  const { error } = await supabase.from("ad_campaigns").insert({ business_id: businessId, name });
  return done(businessId, error, "Campaña creada");
}

export async function addAdMetrics(businessId: string, campaignId: string, _prev: FormState, f: FormData): Promise<FormState> {
  const from = date(f, "from");
  const to = date(f, "to");
  if (!from || !to || to < from) return { ok: false, message: "Revisá el rango de fechas" };
  const spend = parseAmountText(String(f.get("spend") ?? ""));
  if (spend === null) return { ok: false, message: "Poné la inversión del período" };
  const values = { conversations: count(f, "conversations"), impressions: count(f, "impressions"), clicks: count(f, "clicks") };
  if (invalidCounts(Object.values(values))) return { ok: false, message: "Las métricas son números enteros" };
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  const currency = String(f.get("currency") ?? business?.currency ?? "ARS");
  if (business && currency !== business.currency && currency !== "USD") return { ok: false, message: "Moneda inválida" };
  const { error } = await supabase.from("ad_metric_snapshots").insert({
    business_id: businessId,
    campaign_id: campaignId,
    period_start: from,
    period_end: to,
    spend,
    currency,
    ...values,
  });
  return done(businessId, error, "Inversión guardada");
}

const DELETABLE = ["content_items", "content_metric_snapshots", "account_metric_snapshots", "ad_metric_snapshots", "ad_campaigns"];

/** Borra una carga equivocada de marketing (no son registros financieros). */
export async function deleteMarketingRow(businessId: string, table: string, rowId: string): Promise<void> {
  if (!DELETABLE.includes(table)) return;
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", rowId).eq("business_id", businessId);
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}
