// V1.3: cierre por cohortes, ventas directas, cancelaciones técnicas, atribución por
// embudo y calidad de datos. Datos ficticios.
import { describe, expect, it } from "vitest";
import { salesBreakdown } from "./cohort";
import { computeFunnelReport, versionAt } from "./funnels";
import { computeMetrics } from "./metrics";
import { assessQuality } from "./quality";
import type { BusinessData, Funnel, Opportunity, Sale } from "./types";

const MARZO = { from: "2026-03-01", to: "2026-03-31" };
const ABRIL = { from: "2026-04-01", to: "2026-04-30" };

const live: Funnel = {
  id: "f-live", name: "TikTok Live", templateKey: "tiktok_live", channel: "organico", status: "activo", allowsDirectSales: true,
  versions: [
    { id: "v1", version: 1, validFrom: "2026-01-01", notes: null, steps: [{ key: "lives", label: "Lives", unit: "cantidad" }, { key: "vistas", label: "Vistas", unit: "cantidad" }] },
    { id: "v2", version: 2, validFrom: "2026-04-15", notes: null, steps: [{ key: "lives", label: "Lives", unit: "cantidad" }, { key: "espectadores_unicos", label: "Espectadores únicos", unit: "personas" }] },
  ],
};
const meta: Funnel = { id: "f-meta", name: "Meta Ads", templateKey: "meta_whatsapp", channel: "meta_ads", status: "activo", allowsDirectSales: false,
  versions: [{ id: "vm", version: 1, validFrom: "2026-01-01", notes: null, steps: [{ key: "inversion", label: "Inversión", unit: "dinero" }] }] };

function data(): BusinessData {
  return {
    business: { id: "b1", name: "Taller Demo", timezone: "America/Argentina/Buenos_Aires", currency: "ARS", usdRate: 1000, depositsRefundable: false },
    opportunities: [], sales: [], payments: [], adjustments: [], tallies: [], funnels: [live, meta], activities: [],
  };
}

let seq = 0;
function opp(d: BusinessData, createdAt: string, extra: Partial<Opportunity> = {}): Opportunity {
  const o: Opportunity = { id: `o${++seq}`, businessId: "b1", contactId: `c${seq}`, createdAt, stage: "nueva_consulta", source: "organico", lostAt: null, ...extra };
  d.opportunities.push(o);
  return o;
}
function win(d: BusinessData, o: Opportunity, pesos: number, wonAt: string): Sale {
  o.stage = "ganado_completado";
  const s: Sale = { id: `s${++seq}`, businessId: "b1", opportunityId: o.id, contactId: o.contactId, amount: { amount: pesos * 100, currency: "ARS" },
    directCost: null, variableCosts: null, wonAt, status: "vigente", usdRate: 1000 };
  d.sales.push(s);
  return s;
}
const lose = (o: Opportunity, at: string, category: Opportunity["lostCategory"] = "precio") => Object.assign(o, { stage: "perdido", lostAt: at, lostCategory: category });

describe("cierre por cohortes", () => {
  it("ganadas sobre consultas recibidas del período, con las pendientes en el denominador", () => {
    const d = data();
    win(d, opp(d, "2026-04-02T15:00:00Z"), 100_000, "2026-04-03T15:00:00Z");
    lose(opp(d, "2026-04-04T15:00:00Z"), "2026-04-06T15:00:00Z");
    opp(d, "2026-04-05T15:00:00Z");
    opp(d, "2026-04-06T15:00:00Z");
    const close = computeMetrics(d, ABRIL).tasaCierre!;
    expect(close).toMatchObject({ ganadas: 1, perdidas: 1, pendientes: 2, identificadas: 4, ratio: 0.25 });
  });

  it("una consulta de marzo ganada en abril sube el cierre de marzo y es una venta de abril de una cohorte anterior", () => {
    const d = data();
    win(d, opp(d, "2026-03-28T15:00:00Z"), 100_000, "2026-04-02T15:00:00Z");
    opp(d, "2026-03-29T15:00:00Z");
    expect(computeMetrics(d, MARZO).tasaCierre).toMatchObject({ ganadas: 1, identificadas: 2, ratio: 0.5 });
    expect(computeMetrics(d, ABRIL).tasaCierre).toMatchObject({ identificadas: 0, ratio: null });
    expect(salesBreakdown(d, ABRIL)).toEqual({ total: 1, deLaCohorte: 0, deCohortesAnteriores: 1, directas: 0 });
  });

  it("la cobertura compara las consultas identificadas con las recibidas", () => {
    const d = data();
    d.tallies.push({ id: "t1", businessId: "b1", date: "2026-04-02", count: 8, method: "manual" });
    opp(d, "2026-04-02T15:00:00Z");
    opp(d, "2026-04-02T16:00:00Z");
    const close = computeMetrics(d, ABRIL).tasaCierre!;
    expect(close.recibidas).toBe(8);
    expect(close.cobertura).toBe(0.25);
  });
});

describe("ventas directas", () => {
  it("suman facturación y ventas, pero no consultas ni cierre", () => {
    const d = data();
    win(d, opp(d, "2026-04-02T15:00:00Z"), 100_000, "2026-04-02T15:00:00Z");
    lose(opp(d, "2026-04-03T15:00:00Z"), "2026-04-04T15:00:00Z");
    win(d, opp(d, "2026-04-05T15:00:00Z", { entryKind: "venta_directa", funnelId: "f-live" }), 15_000, "2026-04-05T15:00:00Z");
    const m = computeMetrics(d, ABRIL);
    expect(m.consultasCalificadas).toBe(2);
    expect(m.ventasGanadas).toBe(2);
    expect(m.facturacionPactada).toEqual({ ARS: 11_500_000 });
    expect(m.tasaCierre).toMatchObject({ ganadas: 1, identificadas: 2, ratio: 0.5 });
    expect(m.ventas).toEqual({ total: 2, deLaCohorte: 1, deCohortesAnteriores: 0, directas: 1 });
  });
});

describe("cancelaciones técnicas", () => {
  it("revierten la venta y son neutras en el cierre: no son pérdida comercial", () => {
    const d = data();
    win(d, opp(d, "2026-04-02T15:00:00Z"), 100_000, "2026-04-03T15:00:00Z");
    const cancelled = opp(d, "2026-04-04T15:00:00Z");
    const s = win(d, cancelled, 60_000, "2026-04-05T15:00:00Z");
    s.status = "revertida";
    lose(cancelled, "2026-04-08T15:00:00Z", "cancelacion_tecnica");
    const m = computeMetrics(d, ABRIL);
    expect(m.ventasGanadas).toBe(1);
    expect(m.facturacionPactada).toEqual({ ARS: 10_000_000 });
    expect(m.tasaCierre).toMatchObject({ ganadas: 1, perdidas: 0, cancelaciones: 1, identificadas: 1, ratio: 1 });
  });
});

describe("embudos", () => {
  it("cada operación cuenta en un solo embudo: la suma da el total sin duplicar facturación", () => {
    const d = data();
    // Misma persona con una venta por Meta y otra por TikTok Live.
    win(d, opp(d, "2026-04-02T15:00:00Z", { funnelId: "f-meta", contactId: "ana" }), 100_000, "2026-04-03T15:00:00Z");
    win(d, opp(d, "2026-04-10T15:00:00Z", { funnelId: "f-live", contactId: "ana" }), 20_000, "2026-04-10T16:00:00Z");
    win(d, opp(d, "2026-04-11T15:00:00Z", { funnelId: "f-live", entryKind: "venta_directa" }), 15_000, "2026-04-11T15:00:00Z");
    opp(d, "2026-04-12T15:00:00Z");
    d.tallies.push({ id: "t", businessId: "b1", date: "2026-04-12", count: 4, method: "manual" });
    const r = computeFunnelReport(d, ABRIL);
    const liveRow = r.rows.find((x) => x.funnel?.id === "f-live")!;
    expect(liveRow).toMatchObject({ consultas: 1, ventas: 2, ventasDirectas: 1, clientes: 2 });
    const sumVentas = r.rows.reduce((n, x) => n + x.ventas, 0) + r.sinAtribuir.ventas;
    const sumArs = r.rows.reduce((n, x) => n + (x.facturacion.ARS ?? 0), 0) + (r.sinAtribuir.facturacion.ARS ?? 0);
    expect(sumVentas).toBe(r.totals.ventas);
    expect(sumArs).toBe(r.totals.facturacion.ARS);
    expect(r.totals.clientesUnicos).toBe(2);
    // Sin atribuir: 1 identificada sin embudo + 3 que entraron solo en el total del día.
    expect(r.sinAtribuir).toMatchObject({ consultas: 4, sinIdentificar: 3 });
  });

  it("la actividad se resume por versión de los pasos, sin mezclar versiones", () => {
    const d = data();
    d.activities = [
      { id: "a1", funnelId: "f-live", versionId: "v1", occurredOn: "2026-04-05", periodEnd: null, label: null, values: { lives: 1, vistas: 900 }, quality: "real", channel: "manual" },
      { id: "a2", funnelId: "f-live", versionId: "v2", occurredOn: "2026-04-20", periodEnd: null, label: null, values: { lives: 1, espectadores_unicos: 300 }, quality: "real", channel: "manual" },
      { id: "a3", funnelId: "f-live", versionId: "v2", occurredOn: "2026-04-22", periodEnd: null, label: null, values: { lives: 1, espectadores_unicos: 250 }, quality: "estimado", channel: "manual" },
    ];
    const actividad = computeFunnelReport(d, ABRIL).rows.find((x) => x.funnel?.id === "f-live")!.actividad;
    expect(actividad.map((a) => a.version.version)).toEqual([2, 1]);
    expect(actividad[0].steps.find((s) => s.key === "espectadores_unicos")).toMatchObject({ value: 550, quality: "estimado" });
    expect(actividad[1].steps.find((s) => s.key === "vistas")).toMatchObject({ value: 900, quality: "real" });
    expect(versionAt(live, "2026-04-14")?.version).toBe(1);
    expect(versionAt(live, "2026-04-15")?.version).toBe(2);
    expect(versionAt(live, "2025-12-01")?.version).toBe(1);
  });
});

describe("calidad de datos", () => {
  it("marca real, estimado y desconocido, y advierte lo incompleto", () => {
    const d = data();
    d.tallies.push({ id: "t", businessId: "b1", date: "2026-04-02", count: 20, method: "manual" });
    for (let i = 0; i < 4; i++) opp(d, "2026-04-02T15:00:00Z");
    win(d, opp(d, "2026-04-02T16:00:00Z", { funnelId: "f-meta", channel: "archivo" }), 50_000, "2026-04-02T17:00:00Z");
    d.activities = [{ id: "a0", funnelId: "f-live", versionId: "v1", occurredOn: "2026-03-20", periodEnd: null, label: null, values: { lives: 2 }, quality: "real", channel: "manual" }];
    const metrics = computeMetrics(d, ABRIL);
    const q = assessQuality({ data: d, period: ABRIL, metrics, report: computeFunnelReport(d, ABRIL), daysLoaded: 1, days: 30, daysSinceUpdate: 9, pendingReview: 2, minSample: 5 });
    expect(q.labels).toEqual({ consultas: "estimado", cierre: "estimado", facturacion: "real", ganancia: "desconocido" });
    expect(q.coberturaConsultas).toBe(0.25);
    expect(q.coberturaAtribucion).toBe(0.2);
    expect(q.origenVentas).toEqual({ archivo: 1 });
    const texts = q.warnings.map((w) => w.text);
    expect(texts).toContain("Sin cargar hace 9 días");
    expect(texts).toContain("2 coincidencias de importación sin revisar");
    expect(texts).toContain("TikTok Live: sin actividad cargada este mes");
    expect(texts.some((t) => t.startsWith("Meta Ads"))).toBe(false);
    expect(texts.some((t) => t.includes("sin embudo"))).toBe(true);
  });
});
