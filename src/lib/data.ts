import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Business,
  BusinessData,
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
  const [opportunities, sales, payments, adjustments, tallies] = await Promise.all([
    fetchAll<{ id: string; contact_id: string; created_at: string; stage: Opportunity["stage"]; source: Opportunity["source"]; lost_at: string | null }>(
      supabase, "opportunities", "id, contact_id, created_at, stage, source, lost_at", id),
    fetchAll<{ id: string; opportunity_id: string; contact_id: string; amount: number; currency: string; direct_cost: number | null; variable_costs: number | null; won_at: string; status: Sale["status"]; usd_rate: string | null }>(
      supabase, "sales", "id, opportunity_id, contact_id, amount, currency, direct_cost, variable_costs, won_at, status, usd_rate", id),
    fetchAll<{ id: string; opportunity_id: string; sale_id: string | null; amount: number; currency: string; kind: Payment["kind"]; paid_at: string; refunds_payment_id: string | null; usd_rate: string | null }>(
      supabase, "payments", "id, opportunity_id, sale_id, amount, currency, kind, paid_at, refunds_payment_id, usd_rate", id),
    fetchAll<{ id: string; sale_id: string; kind: SaleAdjustment["kind"]; amount_delta: number; currency: string; at: string; reason: string }>(
      supabase, "sale_adjustments", "id, sale_id, kind, amount_delta, currency, at, reason", id),
    fetchAll<{ id: string; date: string; count: number; method: InquiryTally["method"] }>(
      supabase, "inquiry_tallies", "id, date, count, method", id),
  ]);

  return {
    business: toBusiness(business),
    opportunities: opportunities.map((o) => ({
      id: o.id, businessId: id, contactId: o.contact_id, createdAt: o.created_at,
      stage: o.stage, source: o.source, lostAt: o.lost_at,
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
  };
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
