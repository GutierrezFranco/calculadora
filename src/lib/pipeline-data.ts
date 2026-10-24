import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Stage } from "@/domain/types";

export interface PipelineCard {
  id: string;
  stage: Stage;
  need: string | null;
  createdAt: string;
  lastInteractionAt: string | null;
  nextFollowUpAt: string | null;
  lostAt: string | null;
  contactName: string | null;
  phone: string | null;
  /** Monto pactado si está ganada; si no, el último presupuesto. */
  value: { amount: number; currency: string } | null;
  funnelName: string | null;
}

type Row = {
  id: string;
  stage: Stage;
  need: string | null;
  created_at: string;
  last_interaction_at: string | null;
  next_follow_up_at: string | null;
  lost_at: string | null;
  contacts: { name: string | null; contact_phones: { phone_e164: string }[] } | null;
  quotes: { amount: number; currency: string; version: number }[];
  sales: { amount: number; currency: string; status: string }[];
  funnels: { name: string } | null;
};

const COLUMNS = `id, stage, need, created_at, last_interaction_at, next_follow_up_at, lost_at, funnels(name),
  contacts(name, contact_phones(phone_e164)), quotes(amount, currency, version), sales(amount, currency, status)`;

function toCard(r: Row): PipelineCard {
  const active = r.sales.filter((s) => s.status === "vigente");
  const sale = active.length && active.every((s) => s.currency === active[0].currency) ? { amount: active.reduce((n, s) => n + Number(s.amount), 0), currency: active[0].currency } : null;
  const quote = [...r.quotes].sort((a, b) => b.version - a.version)[0];
  const value = sale ?? quote ?? null;
  return {
    id: r.id,
    stage: r.stage,
    need: r.need,
    createdAt: r.created_at,
    lastInteractionAt: r.last_interaction_at,
    nextFollowUpAt: r.next_follow_up_at,
    lostAt: r.lost_at,
    contactName: r.contacts?.name ?? null,
    phone: r.contacts?.contact_phones[0]?.phone_e164 ?? null,
    value: value ? { amount: Number(value.amount), currency: value.currency } : null,
    funnelName: r.funnels?.name ?? null,
  };
}

/**
 * Tarjetas del pipeline: todas las abiertas y en reparación, y las completadas o
 * perdidas de los últimos `recentDays` días (las viejas no hacen falta en el tablero).
 */
export async function loadPipeline(supabase: SupabaseClient, businessId: string, recentDays = 30): Promise<PipelineCard[]> {
  const since = new Date(Date.now() - recentDays * 86_400_000).toISOString();
  const [open, closed] = await Promise.all([
    supabase
      .from("opportunities")
      .select(COLUMNS)
      .eq("business_id", businessId)
      .in("stage", ["nueva_consulta", "presupuestado", "en_seguimiento", "senado", "ganado_en_reparacion"])
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("opportunities")
      .select(COLUMNS)
      .eq("business_id", businessId)
      .in("stage", ["ganado_completado", "perdido"])
      .gte("last_interaction_at", since)
      .order("last_interaction_at", { ascending: false })
      .limit(200),
  ]);
  if (open.error) throw new Error(open.error.message);
  if (closed.error) throw new Error(closed.error.message);
  return [...(open.data as unknown as Row[]), ...(closed.data as unknown as Row[])].map(toCard);
}

export interface OpportunityDetail extends PipelineCard {
  source: string;
  funnelId: string | null;
  funnelName: string | null;
  attributionConfidence: string | null;
  evidence: string | null;
  entryKind: "consulta" | "venta_directa";
  lostCategory: string | null;
  touchpoints: { id: string; funnelName: string; evidence: string | null }[];
  lostReason: string | null;
  contactId: string;
  quotes: { id: string; version: number; amount: number; currency: string; quotedAt: string }[];
  sale: {
    id: string;
    amount: number;
    currency: string;
    directCost: number | null;
    wonAt: string;
    status: "vigente" | "revertida";
  } | null;
  payments: { id: string; amount: number; currency: string; kind: string; method: string | null; paidAt: string | null }[];
}

export async function loadOpportunity(supabase: SupabaseClient, oppId: string): Promise<OpportunityDetail | null> {
  const { data, error } = await supabase
    .from("opportunities")
    .select(
      `id, stage, need, source, created_at, last_interaction_at, next_follow_up_at, lost_at, lost_reason, contact_id,
       funnel_id, attribution_confidence, source_evidence, entry_kind, lost_category, funnels(name),
       attribution_touchpoints(id, evidence, funnels(name)),
       contacts(name, contact_phones(phone_e164)),
       quotes(id, version, amount, currency, quoted_at),
       sales(id, amount, currency, direct_cost, won_at, status),
       payments(id, amount, currency, kind, method, paid_at)`,
    )
    .eq("id", oppId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as unknown as Omit<Row, "quotes" | "sales"> & {
    source: string;
    lost_reason: string | null;
    contact_id: string;
    funnel_id: string | null;
    attribution_confidence: string | null;
    source_evidence: string | null;
    entry_kind: "consulta" | "venta_directa";
    lost_category: string | null;
    funnels: { name: string } | null;
    attribution_touchpoints: { id: string; evidence: string | null; funnels: { name: string } | null }[];
    quotes: { id: string; version: number; amount: number; currency: string; quoted_at: string }[];
    sales: { id: string; amount: number; currency: string; direct_cost: number | null; won_at: string; status: "vigente" | "revertida" }[];
    payments: { id: string; amount: number; currency: string; kind: string; method: string | null; paid_at: string | null }[];
  };
  // Si hubo una venta revertida y otra vigente, se muestra la vigente.
  const sale = r.sales.find((s) => s.status === "vigente") ?? r.sales[0] ?? null;
  return {
    ...toCard(r),
    source: r.source,
    funnelId: r.funnel_id,
    funnelName: r.funnels?.name ?? null,
    attributionConfidence: r.attribution_confidence,
    evidence: r.source_evidence,
    entryKind: r.entry_kind,
    lostCategory: r.lost_category,
    touchpoints: r.attribution_touchpoints.map((t) => ({ id: t.id, funnelName: t.funnels?.name ?? "", evidence: t.evidence })),
    lostReason: r.lost_reason,
    contactId: r.contact_id,
    quotes: r.quotes
      .map((q) => ({ id: q.id, version: q.version, amount: Number(q.amount), currency: q.currency, quotedAt: q.quoted_at }))
      .sort((a, b) => b.version - a.version),
    sale: sale
      ? {
          id: sale.id,
          amount: Number(sale.amount),
          currency: sale.currency,
          directCost: sale.direct_cost === null ? null : Number(sale.direct_cost),
          wonAt: sale.won_at,
          status: sale.status,
        }
      : null,
    payments: r.payments
      .map((p) => ({ id: p.id, amount: Number(p.amount), currency: p.currency, kind: p.kind, method: p.method, paidAt: p.paid_at }))
      .sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? "")),
  };
}

/** Oportunidades abiertas del contacto con ese teléfono (para no duplicar una consulta). */
export async function openOpportunitiesForPhone(
  supabase: SupabaseClient,
  businessId: string,
  phone: string,
): Promise<{ id: string; need: string | null; stage: Stage }[]> {
  const { data: phoneRow } = await supabase
    .from("contact_phones")
    .select("contact_id")
    .eq("business_id", businessId)
    .eq("phone_e164", phone)
    .maybeSingle();
  if (!phoneRow) return [];
  const { data } = await supabase
    .from("opportunities")
    .select("id, need, stage")
    .eq("contact_id", phoneRow.contact_id)
    .in("stage", ["nueva_consulta", "presupuestado", "en_seguimiento", "senado"]);
  return (data ?? []) as { id: string; need: string | null; stage: Stage }[];
}
