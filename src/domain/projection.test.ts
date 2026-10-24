import { describe, expect, it } from "vitest";
import { project, sensitivity, type ProjectionInputs } from "./projection";
import { trafficLight, DEFAULT_THRESHOLDS } from "./traffic-light";

const real = (value: number | null) => ({ value, origin: "real" as const });
const none = { value: null, origin: "estimado" as const };

const base: ProjectionInputs = {
  goalKind: "facturacion",
  goal: 3_000_000_00, // $3.000.000
  ticket: real(60_000_00), // $60.000
  closeRate: real(0.25),
  margin: none,
  paidShare: none,
  costPerInquiry: none,
  inquiriesPerVisit: none,
  prospectShare: none,
  prospectConversion: none,
};

describe("ingeniería inversa de objetivos", () => {
  it("ventas = ceil(meta / ticket) y consultas = ceil(ventas / tasa)", () => {
    const r = project(base);
    expect(r.salesNeeded).toBe(50);
    expect(r.inquiriesNeeded).toBe(200);
    expect(r.adBudget).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it("redondea hacia arriba: no alcanza con media venta", () => {
    expect(project({ ...base, goal: 3_010_000_00 }).salesNeeded).toBe(51);
  });

  it("separa consultas pagas y presupuesto solo con costo por consulta de anuncios", () => {
    const r = project({ ...base, paidShare: real(0.4), costPerInquiry: real(3_000_00) });
    expect(r.paidInquiries).toBe(80);
    expect(r.organicInquiries).toBe(120);
    expect(r.adBudget).toBe(80 * 3_000_00);
  });

  it("si falta el costo por consulta, el presupuesto queda sin calcular y se avisa", () => {
    const r = project({ ...base, paidShare: real(0.4) });
    expect(r.adBudget).toBeNull();
    expect(r.missing).toContain("costo por consulta de anuncios");
  });

  it("meta de contribución pasa a facturación con el margen", () => {
    const r = project({ ...base, goalKind: "contribucion", goal: 1_500_000_00, margin: real(0.5) });
    expect(r.revenueNeeded).toBe(3_000_000_00);
    expect(r.salesNeeded).toBe(50);
    expect(project({ ...base, goalKind: "contribucion" }).missing).toContain("margen de contribución");
  });

  it("prospección: contactos requeridos según la conversión histórica", () => {
    const r = project({ ...base, prospectShare: real(0.2), prospectConversion: real(0.02) });
    expect(r.salesFromProspecting).toBe(10);
    expect(r.salesFromInquiries).toBe(40);
    expect(r.inquiriesNeeded).toBe(160);
    expect(r.prospectContactsNeeded).toBe(500);
  });

  it("visitas al perfil solo si hay una tasa comparable", () => {
    expect(project(base).profileVisitsNeeded).toBeNull();
    expect(project({ ...base, inquiriesPerVisit: real(0.05) }).profileVisitsNeeded).toBe(4000);
  });

  it("sin ticket no inventa números", () => {
    const r = project({ ...base, ticket: none });
    expect(r.salesNeeded).toBeNull();
    expect(r.inquiriesNeeded).toBeNull();
    expect(r.missing).toContain("ticket promedio");
  });

  it("sensibilidad: más ticket o más cierre bajan las consultas necesarias", () => {
    const cells = sensitivity(base);
    const at = (t: number, c: number) => cells.find((x) => x.ticketFactor === t && x.closeDelta === c)!.inquiries!;
    expect(at(1, 0)).toBe(200);
    expect(at(1.1, 0)).toBeLessThan(200);
    expect(at(1, 0.05)).toBeLessThan(200);
    expect(at(0.9, -0.05)).toBeGreaterThan(200);
  });
});

describe("semáforo", () => {
  const t = DEFAULT_THRESHOLDS;
  it("compara contra el ritmo esperado a la fecha", () => {
    expect(trafficLight({ actual: 50, target: 100, expectedFraction: 0.5, sample: 50, thresholds: t })).toBe("verde");
    expect(trafficLight({ actual: 42, target: 100, expectedFraction: 0.5, sample: 50, thresholds: t })).toBe("amarillo");
    expect(trafficLight({ actual: 20, target: 100, expectedFraction: 0.5, sample: 50, thresholds: t })).toBe("rojo");
  });

  it("sin datos o con muestra chica no colorea", () => {
    expect(trafficLight({ actual: null, target: 100, sample: 0, thresholds: t })).toBe("sin_datos");
    expect(trafficLight({ actual: 5, target: null, sample: 50, thresholds: t })).toBe("sin_datos");
    expect(trafficLight({ actual: 1, target: 100, sample: 3, thresholds: t })).toBe("muestra_chica");
  });

  it("en costos, gastar menos es mejor", () => {
    expect(trafficLight({ actual: 80, target: 100, sample: 20, thresholds: t, lowerIsBetter: true })).toBe("verde");
    expect(trafficLight({ actual: 150, target: 100, sample: 20, thresholds: t, lowerIsBetter: true })).toBe("rojo");
  });
});
