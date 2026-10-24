// Tests de los criterios de aceptación de la especificación (sección 12).
// Datos ficticios: "Taller Demo" no es un negocio real.
import { describe, expect, it } from "vitest";
import { lastNDays, previousPeriod } from "./dates";
import { computeMetrics } from "./metrics";
import { money, totalsInUsd } from "./money";
import { assertStageChange, openOpportunitiesFor, refundPayment, reverseSale } from "./pipeline";
import type { BusinessData, Opportunity, Payment, Sale, Stage } from "./types";

const ARS = (pesos: number) => money(pesos * 100, "ARS");
const ABRIL: { from: string; to: string } = { from: "2026-04-01", to: "2026-04-30" };

function emptyData(): BusinessData {
  return {
    business: {
      id: "b1",
      name: "Taller Demo",
      timezone: "America/Argentina/Buenos_Aires",
      currency: "ARS",
      usdRate: 1_000,
      depositsRefundable: false,
    },
    opportunities: [],
    sales: [],
    payments: [],
    adjustments: [],
    tallies: [],
  };
}

let seq = 0;
const id = () => `id${++seq}`;

function opp(data: BusinessData, createdAt: string, stage: Stage = "nueva_consulta", contactId = "c1"): Opportunity {
  const o: Opportunity = { id: id(), businessId: "b1", contactId, createdAt, stage, source: "organico", lostAt: null };
  data.opportunities.push(o);
  return o;
}

function win(data: BusinessData, o: Opportunity, pesos: number, wonAt: string, costPesos?: number): Sale {
  o.stage = "ganado_en_reparacion";
  const s: Sale = {
    id: id(),
    businessId: "b1",
    opportunityId: o.id,
    contactId: o.contactId,
    amount: ARS(pesos),
    directCost: costPesos === undefined ? null : ARS(costPesos),
    variableCosts: null,
    wonAt,
    status: "vigente",
    usdRate: 1_000,
  };
  data.sales.push(s);
  return s;
}

function pay(data: BusinessData, o: Opportunity, pesos: number, kind: Payment["kind"], paidAt: string, saleId: string | null = null): Payment {
  const p: Payment = {
    id: id(),
    businessId: "b1",
    opportunityId: o.id,
    saleId,
    amount: ARS(pesos),
    kind,
    paidAt,
    refundsPaymentId: null,
    usdRate: 1_000,
  };
  data.payments.push(p);
  return p;
}

describe("Consultas y oportunidades", () => {
  it("1. un contacto con dos necesidades distintas: dos oportunidades, dos consultas", () => {
    const data = emptyData();
    opp(data, "2026-04-03T14:00:00Z");
    opp(data, "2026-04-10T14:00:00Z");
    const m = computeMetrics(data, ABRIL);
    expect(m.oportunidadesCreadas).toBe(2);
    expect(m.consultasCalificadas).toBe(2);
  });

  it("2. pregunta tres días seguidos por lo mismo: una oportunidad, no tres", () => {
    const data = emptyData();
    opp(data, "2026-04-03T14:00:00Z");
    // Días 2 y 3: la pantalla encuentra la oportunidad abierta y no crea otra.
    expect(openOpportunitiesFor("c1", data.opportunities)).toHaveLength(1);
    expect(computeMetrics(data, ABRIL).consultasCalificadas).toBe(1);
  });

  it("14. total diario cargado y oportunidades del mismo día: no se duplican", () => {
    const data = emptyData();
    opp(data, "2026-04-03T14:00:00Z");
    opp(data, "2026-04-03T16:00:00Z");
    data.tallies.push({ id: id(), businessId: "b1", date: "2026-04-03", count: 25, method: "manual" });
    opp(data, "2026-04-04T14:00:00Z"); // día sin total cargado: cuenta la oportunidad
    expect(computeMetrics(data, ABRIL).consultasCalificadas).toBe(26);
  });

  it("total manual e importado del mismo día no se suman: manda el manual", () => {
    const data = emptyData();
    data.tallies.push({ id: id(), businessId: "b1", date: "2026-04-03", count: 10, method: "importado" });
    data.tallies.push({ id: id(), businessId: "b1", date: "2026-04-03", count: 12, method: "manual" });
    data.tallies.push({ id: id(), businessId: "b1", date: "2026-04-04", count: 7, method: "importado" });
    expect(computeMetrics(data, ABRIL).consultasCalificadas).toBe(19);
  });
});

describe("Señas, ventas y cobros", () => {
  it("4. seña de $20.000 sin aceptación firme: venta $0, cobrado $20.000, sigue pendiente", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z", "senado");
    pay(data, o, 20_000, "sena", "2026-04-04T14:00:00Z");
    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(0);
    expect(m.facturacionPactada).toEqual({});
    expect(m.cobrado).toEqual({ ARS: 2_000_000 });
    expect(m.tasaCierre?.pendientes).toBe(1);
  });

  it("5. reparación aceptada por $100.000 con anticipo de $50.000", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z");
    const s = win(data, o, 100_000, "2026-04-05T14:00:00Z");
    pay(data, o, 50_000, "anticipo", "2026-04-05T14:00:00Z", s.id);
    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(1);
    expect(m.facturacionPactada).toEqual({ ARS: 10_000_000 });
    expect(m.cobrado).toEqual({ ARS: 5_000_000 });
    expect(m.saldoPendiente).toEqual({ ARS: 5_000_000 });
  });

  it("6. cobro del saldo: sigue siendo una venta y no se duplica la facturación", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z");
    const s = win(data, o, 100_000, "2026-04-05T14:00:00Z");
    pay(data, o, 50_000, "anticipo", "2026-04-05T14:00:00Z", s.id);
    pay(data, o, 50_000, "saldo", "2026-04-12T14:00:00Z", s.id);
    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(1);
    expect(m.facturacionPactada).toEqual({ ARS: 10_000_000 });
    expect(m.cobrado).toEqual({ ARS: 10_000_000 });
    expect(m.saldoPendiente).toEqual({ ARS: 0 });
    expect(m.ticketPactado).toEqual({ ARS: 10_000_000 });
    expect(m.ticketCobrado).toEqual({ ARS: 10_000_000 });
  });

  it("7. reversión con devolución: ajusta todo, conserva el historial y no duplica la devolución", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z");
    const s = win(data, o, 100_000, "2026-04-05T14:00:00Z", 30_000);
    pay(data, o, 100_000, "pago_total", "2026-04-05T14:00:00Z", s.id);

    const result = reverseSale(s, data.payments, {
      adjustmentId: id(),
      at: "2026-04-08T14:00:00Z",
      reason: "El cliente se arrepintió",
      refund: true,
      newId: id,
    });
    data.sales = [result.sale];
    data.adjustments.push(result.adjustment);
    data.payments.push(...result.refunds);

    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(0);
    expect(m.facturacionPactada).toEqual({});
    expect(m.cobrado).toEqual({ ARS: 0 });
    expect(m.contribucion?.totals).toEqual({});
    // El historial queda: la venta original y el cobro original siguen existiendo.
    expect(data.sales[0].status).toBe("revertida");
    expect(data.payments.filter((p) => p.kind === "pago_total")).toHaveLength(1);
    // No se puede devolver dos veces lo mismo.
    expect(() => reverseSale(result.sale, data.payments, { adjustmentId: id(), at: "2026-04-09T00:00:00Z", reason: "x", refund: true, newId: id })).toThrow();
    expect(() => refundPayment(data.payments[0], data.payments, { id: id(), amount: 1, at: "2026-04-09T00:00:00Z" })).toThrow();
  });

  it("seña no reembolsable de una oportunidad perdida queda como seña retenida, no como venta", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z", "senado");
    pay(data, o, 20_000, "sena", "2026-04-04T14:00:00Z");
    o.stage = "perdido";
    o.lostAt = "2026-04-20T14:00:00Z";
    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(0);
    expect(m.senasRetenidas).toEqual({ ARS: 2_000_000 });
    expect(m.tasaCierre).toMatchObject({ ganadas: 0, perdidas: 1, ratio: 0 });
  });

  it("venta sin costo directo cargado: la contribución queda Sin datos", () => {
    const data = emptyData();
    win(data, opp(data, "2026-04-03T14:00:00Z"), 100_000, "2026-04-05T14:00:00Z");
    expect(computeMetrics(data, ABRIL).contribucion).toBeNull();
  });

  it("contribución con costo cargado = venta − costo directo", () => {
    const data = emptyData();
    win(data, opp(data, "2026-04-03T14:00:00Z"), 100_000, "2026-04-05T14:00:00Z", 30_000);
    expect(computeMetrics(data, ABRIL).contribucion).toEqual({ totals: { ARS: 7_000_000 }, ventasSinCosto: 0 });
  });

  it("clientes cuenta personas: una persona con dos ventas es un cliente", () => {
    const data = emptyData();
    win(data, opp(data, "2026-04-03T14:00:00Z"), 50_000, "2026-04-03T15:00:00Z");
    win(data, opp(data, "2026-04-10T14:00:00Z"), 8_000, "2026-04-10T15:00:00Z");
    const m = computeMetrics(data, ABRIL);
    expect(m.ventasGanadas).toBe(2);
    expect(m.clientes).toBe(1);
  });

  it("consulta de marzo ganada en abril cuenta la venta en abril", () => {
    const data = emptyData();
    win(data, opp(data, "2026-03-28T14:00:00Z"), 100_000, "2026-04-02T14:00:00Z");
    expect(computeMetrics(data, ABRIL).ventasGanadas).toBe(1);
    expect(computeMetrics(data, { from: "2026-03-01", to: "2026-03-31" }).ventasGanadas).toBe(0);
  });
});

describe("IA, datos faltantes, períodos y monedas", () => {
  it("8. la IA no puede confirmar un cierre ni una pérdida", () => {
    expect(() => assertStageChange("presupuestado", "ganado_en_reparacion", { actor: "ia", hasSale: true })).toThrow();
    expect(() => assertStageChange("presupuestado", "perdido", { actor: "ia", hasSale: false })).toThrow();
    expect(() => assertStageChange("presupuestado", "ganado_en_reparacion", { actor: "usuario", hasSale: false })).toThrow();
    expect(() => assertStageChange("presupuestado", "ganado_en_reparacion", { actor: "usuario", hasSale: true })).not.toThrow();
  });

  it("11. período sin datos: Sin datos, no cero", () => {
    const m = computeMetrics(emptyData(), ABRIL);
    expect(m.consultasCalificadas).toBeNull();
    expect(m.ventasGanadas).toBeNull();
    expect(m.facturacionPactada).toBeNull();
    expect(m.tasaCierre).toBeNull();
  });

  it("13. 30/60/90 días y comparación con ventana equivalente", () => {
    const data = emptyData();
    win(data, opp(data, "2026-04-25T14:00:00Z"), 10_000, "2026-04-25T15:00:00Z");
    win(data, opp(data, "2026-03-10T14:00:00Z"), 10_000, "2026-03-10T15:00:00Z");
    win(data, opp(data, "2026-02-01T14:00:00Z"), 10_000, "2026-02-01T15:00:00Z");
    const today = "2026-04-30";
    expect(computeMetrics(data, lastNDays(30, today)).ventasGanadas).toBe(1);
    expect(computeMetrics(data, lastNDays(60, today)).ventasGanadas).toBe(2);
    expect(computeMetrics(data, lastNDays(90, today)).ventasGanadas).toBe(3);
    expect(previousPeriod(lastNDays(30, today))).toEqual({ from: "2026-03-02", to: "2026-03-31" });
    expect(computeMetrics(data, previousPeriod(lastNDays(30, today))).ventasGanadas).toBe(1);
  });

  it("los días se cortan en la zona horaria del negocio", () => {
    const data = emptyData();
    // 30/04 22:00 en Buenos Aires = 01/05 01:00 UTC: es una venta de abril.
    win(data, opp(data, "2026-05-01T01:00:00Z"), 10_000, "2026-05-01T01:00:00Z");
    expect(computeMetrics(data, ABRIL).ventasGanadas).toBe(1);
  });

  it("venta en pesos cobrada en dólares: descuenta el saldo con la cotización del cobro", () => {
    const data = emptyData();
    const o = opp(data, "2026-04-03T14:00:00Z");
    const s = win(data, o, 100_000, "2026-04-03T15:00:00Z");
    const p = pay(data, o, 0, "anticipo", "2026-04-03T15:00:00Z", s.id);
    p.amount = money(5_000, "USD"); // USD 50 a $1.000 = $50.000
    const m = computeMetrics(data, ABRIL);
    expect(m.cobrado).toEqual({ USD: 5_000 });
    expect(m.saldoPendiente).toEqual({ ARS: 5_000_000 });
  });

  it("monedas distintas no se suman sin cotización explícita", () => {
    const data = emptyData();
    win(data, opp(data, "2026-04-03T14:00:00Z"), 100_000, "2026-04-03T15:00:00Z");
    const s = win(data, opp(data, "2026-04-04T14:00:00Z", "nueva_consulta", "c2"), 0, "2026-04-04T15:00:00Z");
    s.amount = money(20_000, "USD");
    const m = computeMetrics(data, ABRIL);
    expect(m.facturacionPactada).toEqual({ ARS: 10_000_000, USD: 20_000 });
    expect(totalsInUsd(m.facturacionPactada!, {})).toBeNull();
    expect(totalsInUsd(m.facturacionPactada!, { ARS: 1_000 })).toBe(30_000);
  });
});
