import "server-only";
import { instantInPeriod } from "@/domain/dates";
import { computeMetrics } from "@/domain/metrics";
import { effectiveSaleAmount } from "@/domain/pipeline";
import type { ProjectionInputs } from "@/domain/projection";
import { computeAds, type AdSpendSnapshot } from "@/domain/sources";
import type { BusinessData, Period } from "@/domain/types";
import type { ProspectStats } from "@/lib/data";

/** Valores reales de los últimos 90 días; null si no hay datos suficientes. */
export interface RealValues {
  ticket: number | null;
  closeRate: number | null;
  margin: number | null;
  paidShare: number | null;
  costPerInquiry: number | null;
  inquiriesPerVisit: number | null;
  prospectConversion: number | null;
}

export function realValues(
  data: BusinessData,
  period: Period,
  ads: AdSpendSnapshot[],
  profileVisits: number | null,
  prospects: ProspectStats,
  minSample: number,
): RealValues {
  const currency = data.business.currency;
  const tz = data.business.timezone;
  const m = computeMetrics(data, period);
  const within = (iso: string) => instantInPeriod(iso, period, tz);

  const consultas = m.consultasCalificadas ?? 0;
  const ventas = m.ventasGanadas ?? 0;

  // Margen solo con ventas que tienen costo cargado.
  let revenue = 0;
  let contribution = 0;
  for (const s of data.sales) {
    if (s.status !== "vigente" || !s.directCost || s.amount.currency !== currency || !within(s.wonAt)) continue;
    const amount = effectiveSaleAmount(s, data.adjustments).amount;
    revenue += amount;
    contribution += amount - s.directCost.amount - (s.variableCosts?.amount ?? 0);
  }

  const created = data.opportunities.filter((o) => within(o.createdAt));
  const paid = created.filter((o) => o.source === "meta_ads").length;
  const organic = created.filter((o) => o.source === "organico").length;
  const adsSummary = computeAds(data, period, ads);

  return {
    ticket: m.ticketPactado?.[currency] ?? null,
    closeRate: consultas >= minSample && ventas > 0 ? ventas / consultas : null,
    margin: revenue > 0 ? contribution / revenue : null,
    paidShare: created.length >= minSample ? paid / created.length : null,
    costPerInquiry: adsSummary?.costPerOpportunity?.[currency] ?? null,
    inquiriesPerVisit: profileVisits && organic > 0 ? organic / profileVisits : null,
    prospectConversion: prospects.contacted >= minSample ? prospects.clients / prospects.contacted : null,
  };
}

/** Escenario inicial: meta del mes y supuestos reales donde existen. */
export function defaultInputs(goal: number | null, real: RealValues): ProjectionInputs {
  const a = (value: number | null) => ({ value, origin: value === null ? ("estimado" as const) : ("real" as const) });
  return {
    goalKind: "facturacion",
    goal: goal ?? 0,
    ticket: a(real.ticket),
    closeRate: a(real.closeRate),
    margin: a(real.margin),
    paidShare: a(real.paidShare),
    costPerInquiry: a(real.costPerInquiry),
    inquiriesPerVisit: a(real.inquiriesPerVisit),
    prospectShare: { value: 0, origin: "estimado" },
    prospectConversion: a(real.prospectConversion),
  };
}
