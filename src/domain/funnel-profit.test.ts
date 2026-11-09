import { describe, expect, it } from "vitest";
import { computeFunnelProfit, type ProfitOperation } from "./funnel-profit";

const op = (o: Partial<ProfitOperation>): ProfitOperation => ({
  funnelId: "perfil", contactId: "c1", won: true, amount: 4_500_000, cost: 1_500_000, collected: 4_500_000, currency: "ARS", ...o,
});
const funnels = [
  { id: "perfil", name: "Tráfico al perfil", paid: true },
  { id: "wsp", name: "Anuncios a WhatsApp", paid: true },
  { id: "conocido", name: "Conocido / recomendado", paid: false },
];

describe("rentabilidad por embudo", () => {
  it("calcula tasa de cierre, costos, ganancia y rentabilidad", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      months: [{ funnelId: "perfil", spend: 5_000_000, inquiries: 20 }],
      operations: [
        op({ contactId: "c1" }),
        op({ contactId: "c1", amount: 2_000_000, cost: 500_000, collected: 2_000_000 }), // mismo cliente, segundo trabajo
        op({ contactId: "c2" }),
        op({ contactId: "c3", won: false }),
      ],
    });
    const perfil = r.rows.find((x) => x.funnelId === "perfil")!;
    expect(perfil.clients).toBe(2);
    expect(perfil.jobs).toBe(3);
    expect(perfil.billed).toBe(11_000_000);
    expect(perfil.cost).toBe(3_500_000);
    expect(perfil.profit).toBe(11_000_000 - 3_500_000 - 5_000_000);
    expect(perfil.closeRate).toBeCloseTo(2 / 20);
    expect(perfil.costPerInquiry).toBe(250_000);
    expect(perfil.costPerClient).toBe(2_500_000);
    expect(perfil.roi).toBeCloseTo(2_500_000 / 5_000_000);
    expect(perfil.missing).toEqual([]);
  });

  it("sin inversión cargada en un embudo pago avisa qué falta y no inventa costos", () => {
    const r = computeFunnelProfit({ funnels, currency: "ARS", months: [], operations: [op({ funnelId: "wsp" })] });
    const wsp = r.rows.find((x) => x.funnelId === "wsp")!;
    expect(wsp.spend).toBeNull();
    expect(wsp.costPerClient).toBeNull();
    expect(wsp.roi).toBeNull();
    expect(wsp.missing).toEqual(["inversión", "consultas"]);
  });

  it("conocido no pide inversión, y lo que no tiene origen va aparte", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      months: [],
      operations: [op({ funnelId: "conocido" }), op({ funnelId: null, contactId: "c9" })],
    });
    expect(r.rows.find((x) => x.funnelId === "conocido")!.missing).toEqual([]);
    expect(r.rows.find((x) => x.funnelId === null)!.name).toBe("No sé / sin origen");
    expect(r.total.clients).toBe(2);
  });

  it("el total no duplica clientes que vinieron por dos embudos y suma toda la inversión", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      months: [
        { funnelId: "perfil", spend: 1_000_000, inquiries: 10 },
        { funnelId: "wsp", spend: 2_000_000, inquiries: null },
      ],
      operations: [op({ contactId: "c1" }), op({ funnelId: "wsp", contactId: "c1" })],
    });
    expect(r.total.clients).toBe(1);
    expect(r.total.spend).toBe(3_000_000);
    expect(r.total.inquiries).toBe(10);
  });

  it("trabajos en otra moneda no se mezclan", () => {
    const r = computeFunnelProfit({ funnels, currency: "ARS", months: [], operations: [op({ currency: "USD" })] });
    expect(r.otherCurrency).toBe(1);
    expect(r.total.billed).toBe(0);
  });
});

describe("V1.6: dólares, embudos estimados y métricas del anuncio", () => {
  it("convierte ventas y publicidad en dólares con la cotización guardada en cada registro", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      usdRate: 1_500,
      months: [{ funnelId: "wsp", spend: 2_200, currency: "USD", usdRate: 1_560, inquiries: 24 }], // US$ 22
      operations: [
        op({ funnelId: "wsp", amount: 68_000, cost: 50_000, collected: 68_000, currency: "USD", usdRate: 1_500 }), // US$ 680
        op({ funnelId: "wsp", contactId: "c2", amount: 3_000_000, cost: 1_000_000, collected: 3_000_000 }),
      ],
    });
    const wsp = r.rows.find((x) => x.funnelId === "wsp")!;
    expect(wsp.spend).toBe(3_432_000);
    expect(wsp.billed).toBe(102_000_000 + 3_000_000);
    expect(wsp.cost).toBe(75_000_000 + 1_000_000);
    expect(r.converted).toBe(4);
    expect(r.otherCurrency).toBe(0);
  });

  it("sin cotización no mezcla monedas: lo informa aparte", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      months: [{ funnelId: "wsp", spend: 2_200, currency: "USD", inquiries: 5 }],
      operations: [op({ currency: "USD" })],
    });
    expect(r.otherCurrency).toBe(2);
    expect(r.total.billed).toBe(0);
  });

  it("en embudos no rastreables no da costo por cliente, pero sí la rentabilidad del mes", () => {
    const r = computeFunnelProfit({
      funnels: [{ id: "perfil", name: "Tráfico al perfil", paid: true, traceable: false }],
      currency: "ARS",
      months: [{ funnelId: "perfil", spend: 7_020_000, inquiries: 7 }],
      operations: [op({})],
    });
    const perfil = r.rows[0];
    expect(perfil.traceable).toBe(false);
    expect(perfil.costPerClient).toBeNull();
    expect(perfil.costPerInquiry).toBeCloseTo(1_002_857.14, 1);
    expect(perfil.roi).not.toBeNull();
  });

  it("calcula costo por seguidor y hook rate con los datos opcionales del anuncio", () => {
    const r = computeFunnelProfit({
      funnels,
      currency: "ARS",
      months: [{ funnelId: "perfil", spend: 6_000_000, inquiries: null, followers: 40, plays3s: 520, impressions: 1_000 }],
      operations: [],
    });
    const perfil = r.rows.find((x) => x.funnelId === "perfil")!;
    expect(perfil.costPerFollower).toBe(150_000);
    expect(perfil.hookRate).toBe(0.52);
  });
});
