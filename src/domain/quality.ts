// Calidad de los datos de un negocio (docs/arquitectura-v1-3.md §4): cobertura, origen,
// advertencias y si cada número es real, estimado o desconocido.
import { MIN_COVERAGE } from "./cohort";
import type { FunnelReport } from "./funnels";
import type { PeriodMetrics } from "./metrics";
import type { BusinessData, DataChannel, Period } from "./types";
import { instantInPeriod } from "./dates";

export type Quality = "real" | "estimado" | "desconocido";

export const QUALITY_LABELS: Record<Quality, string> = {
  real: "Real",
  estimado: "Estimado",
  desconocido: "Sin datos",
};

export const CHANNEL_LABELS: Record<DataChannel, string> = {
  manual: "Carga manual",
  archivo: "Excel o CSV",
  google_sheets: "Google Sheets",
  conector: "Conector",
};

export interface Warning {
  level: "alta" | "media";
  text: string;
}

export interface DataQuality {
  /** Consultas identificadas / recibidas. */
  coberturaConsultas: number | null;
  /** Consultas identificadas con embudo / identificadas. */
  coberturaAtribucion: number | null;
  /** Ventas con costo cargado / ventas. */
  coberturaCostos: number | null;
  daysLoaded: number;
  days: number;
  /** De dónde vinieron las ventas del período. */
  origenVentas: Partial<Record<DataChannel, number>>;
  labels: {
    consultas: Quality;
    cierre: Quality;
    facturacion: Quality;
    ganancia: Quality;
  };
  warnings: Warning[];
}

export interface QualityInput {
  data: BusinessData;
  period: Period;
  metrics: PeriodMetrics;
  report: FunnelReport;
  daysLoaded: number;
  days: number;
  /** null si nunca cargó nada. */
  daysSinceUpdate: number | null;
  pendingReview: number;
  minSample: number;
}

const pct = (r: number) => `${Math.round(r * 100)} %`;

export function assessQuality(input: QualityInput): DataQuality {
  const { data, period, metrics: m, report } = input;
  const tz = data.business.timezone;
  const close = m.tasaCierre;
  const identified = report.rows.reduce((n, r) => n + r.cohort.identificadas + r.cohort.cancelaciones, 0);
  const unattributed = report.sinAtribuir.cohort.identificadas + report.sinAtribuir.cohort.cancelaciones;
  const allIdentified = identified + unattributed;

  const oppById = new Map(data.opportunities.map((o) => [o.id, o]));
  const origenVentas: Partial<Record<DataChannel, number>> = {};
  for (const s of data.sales) {
    if (s.status !== "vigente" || !instantInPeriod(s.wonAt, period, tz)) continue;
    const channel = oppById.get(s.opportunityId)?.channel ?? "manual";
    origenVentas[channel] = (origenVentas[channel] ?? 0) + 1;
  }

  const ventas = m.ventasGanadas ?? 0;
  const sinCosto = m.contribucion?.ventasSinCosto ?? ventas;
  const coberturaCostos = ventas > 0 ? (ventas - sinCosto) / ventas : null;
  const loadedShare = input.days > 0 ? input.daysLoaded / input.days : 0;

  const labels: DataQuality["labels"] = {
    consultas: m.consultasCalificadas === null ? "desconocido" : loadedShare >= 0.8 || (close?.cobertura ?? 0) >= 0.95 ? "real" : "estimado",
    cierre: !close || close.ratio === null ? "desconocido" : (close.cobertura ?? 0) >= MIN_COVERAGE ? "real" : "estimado",
    facturacion: m.facturacionPactada === null ? "desconocido" : "real",
    ganancia: m.contribucion === null ? "desconocido" : m.contribucion.ventasSinCosto > 0 ? "estimado" : "real",
  };

  const warnings: Warning[] = [];
  if (input.daysSinceUpdate === null) warnings.push({ level: "alta", text: "Nunca cargó datos" });
  else if (input.daysSinceUpdate >= 7) warnings.push({ level: "alta", text: `Sin cargar hace ${input.daysSinceUpdate} días` });
  if (input.days > 0 && loadedShare < 0.5 && (close?.cobertura ?? 0) < 0.95) {
    warnings.push({ level: "media", text: `Consultas cargadas ${input.daysLoaded} de ${input.days} días` });
  }
  if (close?.cobertura !== null && close?.cobertura !== undefined && close.recibidas >= input.minSample && close.cobertura < MIN_COVERAGE) {
    warnings.push({ level: "media", text: `Solo ${pct(close.cobertura)} de las consultas identificadas: cierre aproximado` });
  }
  if (allIdentified >= input.minSample && unattributed / allIdentified > 0.3) {
    warnings.push({ level: "media", text: `${pct(unattributed / allIdentified)} de las consultas sin embudo` });
  }
  if (labels.ganancia === "estimado") warnings.push({ level: "media", text: `${m.contribucion!.ventasSinCosto} ventas sin costo: ganancia incompleta` });
  for (const r of report.rows) {
    if (r.funnel?.status === "activo" && r.funnel.versions.some((v) => v.steps.length > 0) && r.actividad.length === 0) {
      warnings.push({ level: "media", text: `${r.funnel.name}: activo sin actividad cargada` });
    }
  }
  if (input.pendingReview > 0) warnings.push({ level: "media", text: `${input.pendingReview} coincidencias de importación sin revisar` });

  return {
    coberturaConsultas: close?.cobertura ?? null,
    coberturaAtribucion: allIdentified > 0 ? identified / allIdentified : null,
    coberturaCostos,
    daysLoaded: input.daysLoaded,
    days: input.days,
    origenVentas,
    labels,
    warnings,
  };
}
