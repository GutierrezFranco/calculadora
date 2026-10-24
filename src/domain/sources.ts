// Adquisición por canal: de dónde vienen las oportunidades, cuáles se ganan y cuánto
// cuesta un cliente de anuncios. El origen es el que declaró el alumno en cada oportunidad.
import { daysInPeriod, instantInPeriod } from "./dates";
import { addTo, type MoneyTotals } from "./money";
import { effectiveSaleAmount } from "./pipeline";
import type { BusinessData, LeadSource, LocalDate, Money, Period } from "./types";

export interface AdSpendSnapshot {
  periodStart: LocalDate;
  periodEnd: LocalDate;
  spend: Money;
  conversations: number | null;
}

export interface SourceRow {
  source: LeadSource;
  oportunidades: number;
  ganadas: number;
  perdidas: number;
  tasaCierre: number | null;
  facturacion: MoneyTotals;
  clientes: number;
}

export interface AdsSummary {
  /** Inversión del período (snapshots prorrateados por días superpuestos). */
  spend: MoneyTotals;
  conversations: number | null;
  /** Oportunidades con origen "Anuncios de Meta" creadas en el período. */
  opportunities: number;
  clients: number;
  costPerOpportunity: MoneyTotals | null;
  costPerClient: MoneyTotals | null;
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  organico: "Orgánico",
  meta_ads: "Anuncios de Meta",
  prospeccion: "Prospección",
  referido: "Recomendación",
  directo: "Pasó por el local",
  desconocido: "Sin dato",
  otro: "Otro",
};

/** Días de [from, to] que caen dentro del período. */
function overlapDays(from: LocalDate, to: LocalDate, period: Period): number {
  const start = from > period.from ? from : period.from;
  const end = to < period.to ? to : period.to;
  return start > end ? 0 : daysInPeriod({ from: start, to: end });
}

export function computeBySource(data: BusinessData, period: Period): SourceRow[] {
  const tz = data.business.timezone;
  const within = (iso: string | null) => iso !== null && instantInPeriod(iso, period, tz);
  const sourceOf = new Map(data.opportunities.map((o) => [o.id, o.source]));
  const rows = new Map<LeadSource, SourceRow & { contactIds: Set<string> }>();
  const row = (source: LeadSource) => {
    if (!rows.has(source)) {
      rows.set(source, { source, oportunidades: 0, ganadas: 0, perdidas: 0, tasaCierre: null, facturacion: {}, clientes: 0, contactIds: new Set() });
    }
    return rows.get(source)!;
  };

  for (const o of data.opportunities) {
    if (within(o.createdAt)) row(o.source).oportunidades++;
    if (o.stage === "perdido" && within(o.lostAt)) row(o.source).perdidas++;
  }
  for (const s of data.sales) {
    if (s.status !== "vigente" || !within(s.wonAt)) continue;
    const operation = (data.operations ?? []).find((o) => o.id === s.operationId);
    const operationSource = operation ? data.funnels?.find((f) => f.id === operation.funnelId)?.channel : undefined;
    const r = row(operation ? operationSource ?? "desconocido" : sourceOf.get(s.opportunityId ?? "") ?? "desconocido");
    r.ganadas++;
    r.contactIds.add(s.contactId);
    addTo(r.facturacion, effectiveSaleAmount(s, data.adjustments));
  }

  return [...rows.values()]
    .map(({ contactIds, ...r }) => ({
      ...r,
      clientes: contactIds.size,
      tasaCierre: r.ganadas + r.perdidas > 0 ? r.ganadas / (r.ganadas + r.perdidas) : null,
    }))
    .sort((a, b) => b.oportunidades + b.ganadas - (a.oportunidades + a.ganadas));
}

/**
 * Costo por oportunidad y por cliente de anuncios: inversión atribuible / resultados
 * atribuidos al mismo canal. Nunca se divide por las consultas de todas las fuentes.
 */
export function computeAds(data: BusinessData, period: Period, snapshots: AdSpendSnapshot[]): AdsSummary | null {
  const relevant = snapshots.filter((s) => overlapDays(s.periodStart, s.periodEnd, period) > 0);
  if (relevant.length === 0) return null;

  const spend: MoneyTotals = {};
  let conversations: number | null = 0;
  for (const s of relevant) {
    const share = overlapDays(s.periodStart, s.periodEnd, period) / daysInPeriod({ from: s.periodStart, to: s.periodEnd });
    addTo(spend, { amount: Math.round(s.spend.amount * share), currency: s.spend.currency });
    conversations = s.conversations === null || conversations === null ? null : conversations + Math.round(s.conversations * share);
  }

  const ads = computeBySource(data, period).find((r) => r.source === "meta_ads");
  const opportunities = ads?.oportunidades ?? 0;
  const clients = ads?.clientes ?? 0;
  const per = (n: number) => {
    if (n === 0) return null;
    const result: MoneyTotals = {};
    for (const [currency, amount] of Object.entries(spend)) result[currency] = Math.round((amount ?? 0) / n);
    return result;
  };
  return { spend, conversations, opportunities, clients, costPerOpportunity: per(opportunities), costPerClient: per(clients) };
}
