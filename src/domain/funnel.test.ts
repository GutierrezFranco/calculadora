import { describe, expect, it } from "vitest";
import { computeFunnel } from "./funnel";
import type { BusinessData } from "./types";

const ars = (pesos: number) => ({ amount: pesos * 100, currency: "ARS" });

function data(): BusinessData {
  const base = { businessId: "b", source: "organico" as const, lostAt: null };
  return {
    business: { id: "b", name: "Taller Demo", timezone: "America/Argentina/Buenos_Aires", currency: "ARS", usdRate: 1000, depositsRefundable: false },
    opportunities: [
      { ...base, id: "o1", contactId: "c1", createdAt: "2026-04-02T15:00:00Z", stage: "ganado_completado" },
      { ...base, id: "o2", contactId: "c2", createdAt: "2026-04-03T15:00:00Z", stage: "ganado_en_reparacion" },
      { ...base, id: "o3", contactId: "c3", createdAt: "2026-04-04T15:00:00Z", stage: "en_seguimiento" },
      { ...base, id: "o4", contactId: "c4", createdAt: "2026-04-05T15:00:00Z", stage: "en_seguimiento" },
      // Fuera del período: no entra a la cohorte.
      { ...base, id: "o5", contactId: "c5", createdAt: "2026-03-05T15:00:00Z", stage: "ganado_completado" },
    ],
    sales: [
      { id: "s1", businessId: "b", opportunityId: "o1", contactId: "c1", amount: ars(100_000), directCost: null, variableCosts: null, wonAt: "2026-04-02T16:00:00Z", status: "vigente", usdRate: 1000 },
      { id: "s2", businessId: "b", opportunityId: "o2", contactId: "c2", amount: ars(100_000), directCost: null, variableCosts: null, wonAt: "2026-04-03T16:00:00Z", status: "vigente", usdRate: 1000 },
    ],
    payments: [
      { id: "p1", businessId: "b", opportunityId: "o1", saleId: "s1", amount: ars(100_000), kind: "pago_total", paidAt: "2026-04-02T16:00:00Z", refundsPaymentId: null, usdRate: 1000 },
      { id: "p2", businessId: "b", opportunityId: "o2", saleId: "s2", amount: ars(50_000), kind: "anticipo", paidAt: "2026-04-03T16:00:00Z", refundsPaymentId: null, usdRate: 1000 },
    ],
    adjustments: [],
    tallies: [{ id: "t", businessId: "b", date: "2026-04-02", count: 10, method: "manual" }],
    quotedOpportunityIds: ["o3"],
  };
}

describe("embudo", () => {
  it("sigue a la cohorte del período paso a paso", () => {
    const steps = computeFunnel(data(), { from: "2026-04-01", to: "2026-04-30" });
    // o4 está en seguimiento sin presupuesto: no cuenta como presupuestada.
    // Consultas: 10 del total del 2/4 + 1 oportunidad en cada día sin total (3, 4 y 5 de abril).
    expect(steps.map((s) => [s.label, s.count])).toEqual([
      ["Consultas", 13],
      ["Oportunidades", 4],
      ["Presupuestadas", 3],
      ["Ganadas", 2],
      ["Cobradas completas", 1],
    ]);
    expect(steps[3].rate).toBeCloseTo(2 / 3);
  });
});
