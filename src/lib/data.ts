import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdSpendSnapshot } from "@/domain/sources";
import type { Thresholds } from "@/domain/traffic-light";
import type {
  Business,
  BusinessData,
  DataChannel,
  Funnel,
  FunnelActivity,
  FunnelStepDef,
  InquiryTally,
  Opportunity,
  Payment,
  Sale,
  SaleAdjustment,
} from "@/domain/types";

export interface BusinessRow {
  id: string;
  name: string;
  zone: string | null;
  currency: string;
  timezone: string;
  usd_rate: number | null;
  deposits_refundable: boolean;
  active: boolean;
  created_at: string;
  semaforo_verde: number;
  semaforo_amarillo: number;
  muestra_minima: number;
  program_start: string | null;
}

export function toBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    usdRate: row.usd_rate === null ? null : Number(row.usd_rate),
    depositsRefundable: row.deposits_refundable,
  };
}

const PAGE = 1000;

/** Lee todas las filas de una tabla del negocio, de a páginas (Supabase devuelve hasta 1000 por pedido). */
async function fetchAll<T>(supabase: SupabaseClient, table: string, columns: string, businessId: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("business_id", businessId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`No se pudo leer ${table}: ${error.message}`);
    rows.push(...(data as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

const rate = (value: number | string | null) => (value === null ? null : Number(value));

/** Todos los registros comerciales de un negocio, en el formato del dominio. */
export async function loadBusinessData(supabase: SupabaseClient, business: BusinessRow): Promise<BusinessData> {
  const id = business.id;
  type OppRow = {
    id: string; contact_id: string; created_at: string; stage: Opportunity["stage"]; source: Opportunity["source"]; lost_at: string | null;
    funnel_id: string | null; attribution_confidence: Opportunity["attributionConfidence"]; entry_kind: Opportunity["entryKind"];
    lost_category: Opportunity["lostCategory"]; data_imports: { channel: DataChannel } | null;
  };
  const [opportunities, sales, payments, adjustments, tallies, quotes, funnels] = await Promise.all([
    fetchAll<OppRow>(
      supabase, "opportunities",
      "id, contact_id, created_at, stage, source, lost_at, funnel_id, attribution_confidence, entry_kind, lost_category, data_imports(channel)", id),
    fetchAll<{ id: string; opportunity_id: string; contact_id: string; amount: number; currency: string; direct_cost: number | null; variable_costs: number | null; won_at: string; status: Sale["status"]; usd_rate: string | null }>(
      supabase, "sales", "id, opportunity_id, contact_id, amount, currency, direct_cost, variable_costs, won_at, status, usd_rate", id),
    fetchAll<{ id: string; opportunity_id: string; sale_id: string | null; amount: number; currency: string; kind: Payment["kind"]; paid_at: string; refunds_payment_id: string | null; usd_rate: string | null }>(
      supabase, "payments", "id, opportunity_id, sale_id, amount, currency, kind, paid_at, refunds_payment_id, usd_rate", id),
    fetchAll<{ id: string; sale_id: string; kind: SaleAdjustment["kind"]; amount_delta: number; currency: string; at: string; reason: string }>(
      supabase, "sale_adjustments", "id, sale_id, kind, amount_delta, currency, at, reason", id),
    fetchAll<{ id: string; date: string; count: number; method: InquiryTally["method"] }>(
      supabase, "inquiry_tallies", "id, date, count, method", id),
    fetchAll<{ opportunity_id: string }>(supabase, "quotes", "opportunity_id", id),
    loadFunnels(supabase, id),
  ]);

  return {
    business: toBusiness(business),
    opportunities: opportunities.map((o) => ({
      id: o.id, businessId: id, contactId: o.contact_id, createdAt: o.created_at,
      stage: o.stage, source: o.source, lostAt: o.lost_at, funnelId: o.funnel_id, attributionConfidence: o.attribution_confidence,
      entryKind: o.entry_kind, lostCategory: o.lost_category, channel: o.data_imports?.channel ?? "manual",
    })),
    sales: sales.map((s) => ({
      id: s.id, businessId: id, opportunityId: s.opportunity_id, contactId: s.contact_id,
      amount: { amount: Number(s.amount), currency: s.currency },
      directCost: s.direct_cost === null ? null : { amount: Number(s.direct_cost), currency: s.currency },
      variableCosts: s.variable_costs === null ? null : { amount: Number(s.variable_costs), currency: s.currency },
      wonAt: s.won_at, status: s.status, usdRate: rate(s.usd_rate),
    })),
    payments: payments.map((p) => ({
      id: p.id, businessId: id, opportunityId: p.opportunity_id, saleId: p.sale_id,
      amount: { amount: Number(p.amount), currency: p.currency }, kind: p.kind, paidAt: p.paid_at,
      refundsPaymentId: p.refunds_payment_id, usdRate: rate(p.usd_rate),
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id, saleId: a.sale_id, kind: a.kind,
      amountDelta: { amount: Number(a.amount_delta), currency: a.currency }, at: a.at, reason: a.reason,
    })),
    tallies: tallies.map((t) => ({ id: t.id, businessId: id, date: t.date, count: t.count, method: t.method })),
    quotedOpportunityIds: [...new Set(quotes.map((q) => q.opportunity_id))],
    funnels: funnels.funnels,
    activities: funnels.activities,
  };
}

/** Embudos del negocio con sus versiones y su actividad. */
export async function loadFunnels(supabase: SupabaseClient, businessId: string): Promise<{ funnels: Funnel[]; activities: FunnelActivity[] }> {
  const [funnels, versions, activities] = await Promise.all([
    fetchAll<{ id: string; name: string; template_key: string | null; channel: Funnel["channel"]; status: Funnel["status"]; allows_direct_sales: boolean; created_at: string }>(
      supabase, "funnels", "id, name, template_key, channel, status, allows_direct_sales, created_at", businessId),
    fetchAll<{ id: string; funnel_id: string; version: number; valid_from: string; steps: FunnelStepDef[]; notes: string | null }>(
      supabase, "funnel_versions", "id, funnel_id, version, valid_from, steps, notes", businessId),
    fetchAll<{ id: string; funnel_id: string; version_id: string; occurred_on: string; period_end: string | null; label: string | null; step_values: Record<string, number>; quality: FunnelActivity["quality"]; channel: DataChannel }>(
      supabase, "funnel_activities", "id, funnel_id, version_id, occurred_on, period_end, label, step_values, quality, channel", businessId),
  ]);
  return {
    funnels: funnels
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((f) => ({
        id: f.id, name: f.name, templateKey: f.template_key, channel: f.channel, status: f.status, allowsDirectSales: f.allows_direct_sales,
        versions: versions
          .filter((v) => v.funnel_id === f.id)
          .sort((a, b) => a.version - b.version)
          .map((v) => ({ id: v.id, version: v.version, validFrom: v.valid_from, steps: v.steps, notes: v.notes })),
      })),
    activities: activities.map((a) => ({
      id: a.id, funnelId: a.funnel_id, versionId: a.version_id, occurredOn: a.occurred_on, periodEnd: a.period_end,
      label: a.label, values: a.step_values, quality: a.quality, channel: a.channel,
    })),
  };
}

export interface FunnelTemplate {
  key: string;
  name: string;
  description: string;
  steps: FunnelStepDef[];
  allowsDirectSales: boolean;
}

export async function loadTemplates(supabase: SupabaseClient): Promise<FunnelTemplate[]> {
  const { data, error } = await supabase.from("funnel_templates").select("key, name, description, steps, allows_direct_sales").order("sort");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ key: t.key, name: t.name, description: t.description, steps: t.steps, allowsDirectSales: t.allows_direct_sales }));
}

/** Filas de importación con coincidencias dudosas sin resolver. */
export async function countPendingReview(supabase: SupabaseClient, businessId: string): Promise<number> {
  const { count } = await supabase
    .from("ingestion_rows")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("status", "dudosa");
  return count ?? 0;
}

export async function getBusiness(supabase: SupabaseClient, id: string): Promise<BusinessRow | null> {
  const { data } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
  return (data as BusinessRow | null) ?? null;
}

/** Fecha y hora del último cambio cargado en el negocio, según la auditoría. */
export async function lastUpdate(supabase: SupabaseClient, businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from("audit_log")
    .select("at")
    .eq("business_id", businessId)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.at as string | undefined) ?? null;
}

export interface MonthlyGoals {
  facturacion: number | null;
  ventas: number | null;
  consultas: number | null;
}

/** Objetivos mensuales de un mes (periodStart = primer día, YYYY-MM-01). */
export async function loadGoals(supabase: SupabaseClient, businessId: string, periodStart: string): Promise<MonthlyGoals> {
  const { data } = await supabase
    .from("goals")
    .select("metric, target")
    .eq("business_id", businessId)
    .eq("period_kind", "mensual")
    .eq("period_start", periodStart);
  const get = (metric: string) => {
    const row = data?.find((g) => g.metric === metric);
    return row ? Number(row.target) : null;
  };
  return { facturacion: get("facturacion"), ventas: get("ventas"), consultas: get("consultas") };
}

export function thresholdsOf(row: BusinessRow): Thresholds {
  return { green: Number(row.semaforo_verde), yellow: Number(row.semaforo_amarillo), minSample: row.muestra_minima };
}

/** Inversión en anuncios cargada (todas las campañas). */
export async function loadAdSnapshots(supabase: SupabaseClient, businessId: string): Promise<AdSpendSnapshot[]> {
  const { data, error } = await supabase
    .from("ad_metric_snapshots")
    .select("period_start, period_end, spend, currency, conversations")
    .eq("business_id", businessId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    periodStart: s.period_start,
    periodEnd: s.period_end,
    spend: { amount: Number(s.spend), currency: s.currency },
    conversations: s.conversations,
  }));
}

/** Seguimientos vencidos y oportunidades abiertas sin movimiento hace más de 14 días. */
export async function loadPipelineHealth(supabase: SupabaseClient, businessId: string): Promise<{ overdue: number; stale: number }> {
  const now = new Date();
  const staleSince = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const open = ["nueva_consulta", "presupuestado", "en_seguimiento", "senado"];
  const [overdue, stale] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("stage", open)
      .lt("next_follow_up_at", now.toISOString()),
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("stage", open)
      .lt("last_interaction_at", staleSince),
  ]);
  return { overdue: overdue.count ?? 0, stale: stale.count ?? 0 };
}

/** Visitas al perfil cargadas en snapshots de cuenta que caen dentro del período (prorrateadas). */
export async function loadProfileVisits(supabase: SupabaseClient, businessId: string, from: string, to: string): Promise<number | null> {
  const { data } = await supabase
    .from("account_metric_snapshots")
    .select("period_start, period_end, profile_visits")
    .eq("business_id", businessId)
    .lte("period_start", to)
    .gte("period_end", from)
    .not("profile_visits", "is", null);
  if (!data || data.length === 0) return null;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  let visits = 0;
  for (const s of data) {
    const start = Math.max(day(s.period_start), day(from));
    const end = Math.min(day(s.period_end), day(to));
    const share = (end - start + 1) / (day(s.period_end) - day(s.period_start) + 1);
    visits += Math.round((s.profile_visits ?? 0) * share);
  }
  return visits;
}

export interface ProspectStats {
  total: number;
  contacted: number;
  responded: number;
  interested: number;
  converted: number;
  clients: number;
}

/** Embudo de prospección acumulado: cuántos llegaron a cada etapa. Cliente = la oportunidad se ganó. */
export async function loadProspectStats(supabase: SupabaseClient, businessId: string): Promise<ProspectStats> {
  const { data, error } = await supabase
    .from("prospects")
    .select("contacted_at, responded_at, interested_at, converted_at, opportunity_id, opportunities(sales(status))")
    .eq("business_id", businessId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    contacted_at: string | null; responded_at: string | null; interested_at: string | null; converted_at: string | null;
    opportunities: { sales: { status: string }[] } | null;
  }[];
  return {
    total: rows.length,
    contacted: rows.filter((r) => r.contacted_at).length,
    responded: rows.filter((r) => r.responded_at).length,
    interested: rows.filter((r) => r.interested_at).length,
    converted: rows.filter((r) => r.converted_at).length,
    clients: rows.filter((r) => r.opportunities?.sales.some((s) => s.status === "vigente")).length,
  };
}
