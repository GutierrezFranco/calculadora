import { instantInPeriod } from "./dates";
import { computeMetrics } from "./metrics";
import { convert } from "./money";
import { effectiveSaleAmount } from "./pipeline";
import type { BusinessData, Period } from "./types";

export interface FunnelStep {
  label: string;
  count: number | null;
  /** Proporción respecto del paso anterior; null si no se puede calcular. */
  rate: number | null;
}

/**
 * Embudo por cohorte: sigue a las oportunidades creadas en el período hasta hoy.
 * Consultas usa la misma regla que el dashboard (totales diarios u oportunidades).
 */
export function computeFunnel(data: BusinessData, period: Period): FunnelStep[] {
  const tz = data.business.timezone;
  const consultas = computeMetrics(data, period).consultasCalificadas;
  const cohort = data.opportunities.filter((o) => instantInPeriod(o.createdAt, period, tz));
  const quoted = new Set(data.quotedOpportunityIds ?? []);
  const saleByOpp = new Map(data.sales.filter((s) => s.status === "vigente").map((s) => [s.opportunityId, s]));

  const presupuestadas = cohort.filter(
    // "En seguimiento" no implica presupuesto: cuenta solo si hubo uno registrado.
    (o) => quoted.has(o.id) || saleByOpp.has(o.id) || ["presupuestado", "senado"].includes(o.stage),
  );
  const ganadas = cohort.filter((o) => saleByOpp.has(o.id));
  const cobradas = ganadas.filter((o) => {
    const sale = saleByOpp.get(o.id)!;
    const amount = effectiveSaleAmount(sale, data.adjustments);
    let paid = 0;
    for (const p of data.payments.filter((p) => p.opportunityId === o.id)) {
      const value = convert(p.amount, amount.currency, p.usdRate);
      if (value) paid += p.kind === "devolucion" ? -value.amount : value.amount;
    }
    return paid >= amount.amount;
  });

  const counts: [string, number | null][] = [
    ["Consultas", consultas],
    ["Oportunidades", cohort.length],
    ["Presupuestadas", presupuestadas.length],
    ["Ganadas", ganadas.length],
    ["Cobradas completas", cobradas.length],
  ];
  return counts.map(([label, count], i) => {
    const previous = i > 0 ? counts[i - 1][1] : null;
    return { label, count, rate: count !== null && previous ? count / previous : null };
  });
}
