import { describe, expect, it } from "vitest";
import { diagnose, mentorAlerts, type DiagnosisInput } from "./diagnosis";
import type { CohortResult } from "./cohort";
import type { PeriodMetrics } from "./metrics";

const cohort = (ganadas: number, perdidas: number, pendientes: number, recibidas = 100): CohortResult => {
  const identificadas = ganadas + perdidas + pendientes;
  return { recibidas, identificadas, ganadas, perdidas, pendientes, cancelaciones: 0, ratio: identificadas ? ganadas / identificadas : null, cobertura: Math.min(identificadas / recibidas, 1) };
};

const period = { from: "2026-04-01", to: "2026-04-30" };

function metrics(over: Partial<PeriodMetrics> = {}): PeriodMetrics {
  return {
    period, consultasCalificadas: 100, oportunidadesCreadas: 40, ventasGanadas: 20, ventas: { total: 20, deLaCohorte: 15, deCohortesAnteriores: 5, directas: 0 }, clientes: 18,
    facturacionPactada: { ARS: 2_000_000_00 }, cobrado: { ARS: 1_900_000_00 }, saldoPendiente: { ARS: 100_000_00 },
    contribucion: { totals: { ARS: 1_000_000_00 }, ventasSinCosto: 0 },
    tasaCierre: cohort(40, 35, 5, 100),
    ticketPactado: { ARS: 100_000_00 }, ticketCobrado: { ARS: 95_000_00 }, senasRetenidas: {}, avisos: [], ...over,
  };
}

const funnel = (opps: number, quoted: number) => [
  { label: "Consultas", count: 100, rate: null },
  { label: "Oportunidades", count: opps, rate: null },
  { label: "Presupuestadas", count: quoted, rate: null },
  { label: "Ganadas", count: 20, rate: null },
  { label: "Cobradas completas", count: 18, rate: null },
];

const base: DiagnosisInput = {
  metrics: metrics(), previous: metrics(), funnel: funnel(40, 35), currency: "ARS",
  daysLoaded: 30, days: 30, overdueFollowUps: 0, staleOpen: 0, minSample: 10,
};

describe("diagnóstico", () => {
  it("negocio sano: sin hallazgos", () => {
    expect(diagnose(base)).toEqual([]);
  });

  it("sin datos: un solo aviso, sin diagnóstico falso (criterio 11)", () => {
    const empty = metrics({ consultasCalificadas: null, tasaCierre: null, ventasGanadas: null });
    const result = diagnose({ ...base, metrics: empty, previous: empty, daysLoaded: 0 });
    expect(result.map((f) => f.id)).toEqual(["sin_datos"]);
  });

  it("detecta cuellos de botella con datos suficientes, los más graves primero", () => {
    const result = diagnose({
      ...base,
      metrics: metrics({ consultasCalificadas: 60, tasaCierre: cohort(4, 16, 30, 60) }),
      funnel: funnel(40, 10),
      daysLoaded: 10,
      overdueFollowUps: 6,
    }).map((f) => f.id);
    expect(result.slice(0, 3).sort()).toEqual(["cierre_bajo", "poco_presupuesto", "seguimientos_vencidos"]);
    expect(result).toContain("carga_incompleta");
    expect(result).toContain("muchos_pendientes");
    expect(result).toContain("menos_consultas");
    // Con 30 de 50 consultas abiertas la cohorte puede subir: no se la compara todavía.
    expect(result).not.toContain("cierre_bajo_vs_anterior");
  });

  it("compara el cierre con el período anterior solo cuando la cohorte está casi cerrada", () => {
    const result = diagnose({ ...base, metrics: metrics({ tasaCierre: cohort(10, 25, 5, 50) }) }).map((f) => f.id);
    expect(result).toContain("cierre_bajo_vs_anterior");
  });

  it("avisa cuando pocas consultas están cargadas una por una", () => {
    const result = diagnose({ ...base, metrics: metrics({ tasaCierre: cohort(20, 15, 5, 100) }) }).map((f) => f.id);
    expect(result).toContain("cobertura_baja");
  });

  it("con muestra chica no juzga tasas", () => {
    const result = diagnose({
      ...base,
      metrics: metrics({ consultasCalificadas: 5, tasaCierre: cohort(0, 3, 2, 5) }),
      previous: metrics({ consultasCalificadas: 6 }),
      funnel: funnel(4, 0),
    }).map((f) => f.id);
    expect(result).not.toContain("cierre_bajo");
    expect(result).not.toContain("poco_presupuesto");
    expect(result).not.toContain("menos_consultas");
  });
});

describe("alertas del mentor", () => {
  it("es prudente: un negocio sano no tiene alertas", () => {
    expect(mentorAlerts({ metrics: metrics(), previous: metrics(), daysLoaded: 28, days: 30, daysSinceUpdate: 1, staleOpen: 0, minSample: 10 })).toEqual([]);
  });

  it("marca inactividad, carga incompleta y empeoramiento", () => {
    const alerts = mentorAlerts({
      metrics: metrics({ consultasCalificadas: 40, ventasGanadas: 5 }),
      previous: metrics(),
      daysLoaded: 8, days: 30, daysSinceUpdate: 9, staleOpen: 6, minSample: 10,
    });
    expect(alerts).toEqual([
      "Sin actividad hace 9 días", "Carga de consultas incompleta", "Bajaron las consultas", "Bajaron las ventas", "6 oportunidades estancadas",
    ]);
    expect(mentorAlerts({ metrics: metrics(), previous: metrics(), daysLoaded: 0, days: 30, daysSinceUpdate: null, staleOpen: 0, minSample: 10 }))
      .toEqual(["Nunca cargó datos"]);
  });
});
