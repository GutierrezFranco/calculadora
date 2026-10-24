import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eachDay, localDate, monthPeriod, shiftMonth } from "@/domain/dates";
import { computeFunnelReport, type FunnelReport } from "@/domain/funnels";
import { computeMetrics, type PeriodMetrics } from "@/domain/metrics";
import { assessQuality, type DataQuality } from "@/domain/quality";
import type { BusinessData } from "@/domain/types";
import { countPendingReview, lastUpdate, loadBusinessData, thresholdsOf, type BusinessRow } from "@/lib/data";
import { daysSince } from "@/lib/format";

export interface StudentSummary {
  business: BusinessRow;
  data: BusinessData;
  metrics: PeriodMetrics;
  previous: PeriodMetrics;
  report: FunnelReport;
  quality: DataQuality;
  updatedAt: string | null;
  /** Facturación en moneda local de los últimos 6 meses (null = sin datos). */
  spark: (number | null)[];
  /** Resumen de la actividad de captación del mes, por embudo. */
  actions: string[];
}

export async function summarizeStudent(supabase: SupabaseClient, b: BusinessRow, month: string): Promise<StudentSummary> {
  const [data, updatedAt, pendingReview] = await Promise.all([
    loadBusinessData(supabase, b),
    lastUpdate(supabase, b.id),
    countPendingReview(supabase, b.id),
  ]);
  const today = localDate(new Date().toISOString(), b.timezone);
  const period = monthPeriod(month, today);
  const metrics = computeMetrics(data, period);
  const previous = computeMetrics(data, monthPeriod(shiftMonth(month, -1), today));
  const report = computeFunnelReport(data, period);
  const days = new Set(eachDay(period));
  const daysLoaded = new Set(data.tallies.filter((t) => days.has(t.date)).map((t) => t.date)).size;
  const quality = assessQuality({
    data, period, metrics, report, daysLoaded, days: days.size,
    daysSinceUpdate: updatedAt ? daysSince(updatedAt) : null, pendingReview, minSample: thresholdsOf(b).minSample,
  });
  const spark = Array.from({ length: 6 }, (_, i) => {
    const m = computeMetrics(data, monthPeriod(shiftMonth(month, i - 5), today));
    return m.facturacionPactada ? (m.facturacionPactada[b.currency] ?? 0) : null;
  });
  const actions = report.rows.flatMap((r) => {
    const a = r.actividad[0];
    if (!a) return [];
    const first = a.steps.find((s) => s.value > 0);
    return first ? [`${first.value.toLocaleString("es-AR")} ${first.label.toLowerCase()}`] : [];
  });
  return { business: b, data, metrics, previous, report, quality, updatedAt, spark, actions };
}

export interface Baseline {
  month: string;
  /** datos: calculado con lo cargado ese mes; declarado: lo cargó el mentor. */
  source: "datos" | "declarado" | "sin_datos";
  consultas: number | null;
  clientes: number | null;
  cierre: number | null;
  facturacion: number | null;
}

/** Línea de base del mes de ingreso: con datos cargados si los hay; si no, lo declarado. */
export function baselineFor(
  data: BusinessData,
  programStart: string | null,
  declared: { consultas: number | null; clientes: number | null; facturacion: number | null } | null,
  currency: string,
): Baseline | null {
  if (!programStart) return null;
  const month = programStart.slice(0, 7);
  const today = localDate(new Date().toISOString(), data.business.timezone);
  const m = computeMetrics(data, monthPeriod(month, today));
  if (m.consultasCalificadas !== null || m.facturacionPactada !== null) {
    return {
      month,
      source: "datos",
      consultas: m.consultasCalificadas,
      clientes: m.clientes,
      cierre: m.tasaCierre?.ratio ?? null,
      facturacion: m.facturacionPactada ? (m.facturacionPactada[currency] ?? 0) : null,
    };
  }
  if (declared && (declared.consultas !== null || declared.facturacion !== null || declared.clientes !== null)) {
    return { month, source: "declarado", consultas: declared.consultas, clientes: declared.clientes, cierre: null, facturacion: declared.facturacion };
  }
  return { month, source: "sin_datos", consultas: null, clientes: null, cierre: null, facturacion: null };
}
