import { describe, expect, it } from "vitest";
import { computeAds, computeBySource } from "./sources";
import type { BusinessData, LeadSource, Opportunity, Sale } from "./types";

const ABRIL = { from: "2026-04-01", to: "2026-04-30" };

function build(): BusinessData {
  const opp = (id: string, source: LeadSource, extra: Partial<Opportunity> = {}): Opportunity => ({
    id, businessId: "b", contactId: `c-${id}`, createdAt: "2026-04-05T15:00:00Z", stage: "presupuestado", source, lostAt: null, ...extra,
  });
  const sale = (oppId: string, pesos: number): Sale => ({
    id: `s-${oppId}`, businessId: "b", opportunityId: oppId, contactId: `c-${oppId}`, amount: { amount: pesos * 100, currency: "ARS" },
    directCost: null, variableCosts: null, wonAt: "2026-04-10T15:00:00Z", status: "vigente", usdRate: null,
  });
  return {
    business: { id: "b", name: "Taller Demo", timezone: "America/Argentina/Buenos_Aires", currency: "ARS", usdRate: null, depositsRefundable: false },
    opportunities: [
      opp("a1", "meta_ads", { stage: "ganado_completado" }),
      opp("a2", "meta_ads", { stage: "ganado_completado" }),
      opp("a3", "meta_ads", { stage: "perdido", lostAt: "2026-04-12T15:00:00Z" }),
      opp("a4", "meta_ads"),
      opp("o1", "organico", { stage: "ganado_completado" }),
    ],
    sales: [sale("a1", 50_000), sale("a2", 70_000), sale("o1", 30_000)],
    payments: [],
    adjustments: [],
    tallies: [],
  };
}

describe("adquisición por canal", () => {
  it("cuenta oportunidades, ganadas, tasa y facturación por origen", () => {
    const rows = computeBySource(build(), ABRIL);
    const ads = rows.find((r) => r.source === "meta_ads")!;
    expect(ads).toMatchObject({ oportunidades: 4, ganadas: 2, perdidas: 1, clientes: 2, facturacion: { ARS: 12_000_000 } });
    expect(ads.tasaCierre).toBeCloseTo(2 / 3);
    expect(rows.find((r) => r.source === "organico")).toMatchObject({ oportunidades: 1, ganadas: 1 });
  });

  it("costo por cliente de anuncios = inversión prorrateada / clientes de anuncios", () => {
    // Snapshot de 10 días (25/3 al 3/4): solo 3 días caen en abril.
    const summary = computeAds(build(), ABRIL, [
      { periodStart: "2026-04-01", periodEnd: "2026-04-30", spend: { amount: 100_000_00, currency: "ARS" }, conversations: 40 },
      { periodStart: "2026-03-25", periodEnd: "2026-04-03", spend: { amount: 10_000_00, currency: "ARS" }, conversations: 10 },
    ])!;
    expect(summary.spend).toEqual({ ARS: 103_000_00 });
    expect(summary.conversations).toBe(43);
    expect(summary.costPerClient).toEqual({ ARS: 51_500_00 });
    expect(summary.costPerOpportunity).toEqual({ ARS: 25_750_00 });
  });

  it("sin inversión cargada no hay costo por cliente", () => {
    expect(computeAds(build(), ABRIL, [])).toBeNull();
  });
});
