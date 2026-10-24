// Consultas recibidas y tasa de cierre por cohorte (docs/arquitectura-v1-3.md §1).
// La cohorte de un período son las consultas identificadas creadas en él; se siguen
// hasta hoy. Las ventas directas no son consultas y las cancelaciones técnicas son neutras.
import { eachDay, instantInPeriod, localDate } from "./dates";
import type { BusinessData, InquiryTally, LocalDate, Opportunity, Period } from "./types";

export const isInquiry = (o: Opportunity) => (o.entryKind ?? "consulta") === "consulta";
export const isTechnicalCancellation = (o: Opportunity) => o.stage === "perdido" && o.lostCategory === "cancelacion_tecnica";

/** Debajo de esta cobertura la tasa de cierre se muestra con advertencia. */
export const MIN_COVERAGE = 0.7;

export interface InquiryCount {
  /** Consultas recibidas: el total del día manda sobre las consultas identificadas de ese día. */
  total: number;
  /** Consultas cargadas una por una (oportunidades de tipo consulta). */
  identificadas: number;
  /** Días del período con algún total diario cargado. */
  daysWithTally: number;
  avisos: string[];
}

/**
 * Si un día tiene totales de varias fuentes manda el manual, después el importado y por
 * último el de WhatsApp: nunca se suman entre sí ni con las consultas identificadas.
 */
export function countInquiries(data: BusinessData, period: Period): InquiryCount {
  const tz = data.business.timezone;
  const days = new Set(eachDay(period));
  const priority: Record<InquiryTally["method"], number> = { manual: 0, importado: 1, whatsapp: 2 };
  const chosen = new Map<LocalDate, InquiryTally>();
  for (const t of data.tallies) {
    if (!days.has(t.date)) continue;
    const current = chosen.get(t.date);
    if (!current || priority[t.method] < priority[current.method]) chosen.set(t.date, t);
  }
  const oppsByDay = new Map<LocalDate, number>();
  let identificadas = 0;
  for (const o of data.opportunities) {
    if (!isInquiry(o) || !instantInPeriod(o.createdAt, period, tz)) continue;
    identificadas++;
    const day = localDate(o.createdAt, tz);
    oppsByDay.set(day, (oppsByDay.get(day) ?? 0) + 1);
  }
  const avisos: string[] = [];
  let total = 0;
  for (const day of days) {
    const tally = chosen.get(day)?.count;
    const opps = oppsByDay.get(day) ?? 0;
    if (tally === undefined) {
      total += opps;
    } else {
      // Si hay más consultas identificadas que el total cargado, manda lo identificado.
      total += Math.max(tally, opps);
      if (opps > tally) avisos.push(`${day}: hay ${opps} consultas cargadas pero el total del día dice ${tally}`);
    }
  }
  return { total, identificadas, daysWithTally: chosen.size, avisos };
}

export interface CohortResult {
  /** Consultas recibidas en el período (identificadas o no). */
  recibidas: number;
  /** Consultas identificadas de la cohorte, sin las cancelaciones técnicas. */
  identificadas: number;
  ganadas: number;
  perdidas: number;
  /** Siguen abiertas hoy: la cohorte todavía puede subir. */
  pendientes: number;
  cancelaciones: number;
  /** ganadas / identificadas; null sin consultas identificadas. */
  ratio: number | null;
  /** Consultas cargadas una por una / recibidas; null sin consultas recibidas. */
  cobertura: number | null;
}

/** Cierre de una cohorte de consultas (ya filtradas: del período, y del embudo si corresponde). */
export function cohortResult(cohort: Opportunity[], data: BusinessData, recibidas: number): CohortResult {
  const won = new Set(data.sales.filter((s) => s.status === "vigente").map((s) => s.opportunityId));
  let ganadas = 0;
  let perdidas = 0;
  let pendientes = 0;
  let cancelaciones = 0;
  for (const o of cohort) {
    if (isTechnicalCancellation(o)) cancelaciones++;
    else if (won.has(o.id)) ganadas++;
    else if (o.stage === "perdido") perdidas++;
    else pendientes++;
  }
  const identificadas = cohort.length - cancelaciones;
  return {
    recibidas,
    identificadas,
    ganadas,
    perdidas,
    pendientes,
    cancelaciones,
    ratio: identificadas > 0 ? ganadas / identificadas : null,
    // La cobertura mide qué parte de lo recibido está cargado una por una (cancelaciones incluidas).
    cobertura: recibidas > 0 ? Math.min(cohort.length / recibidas, 1) : null,
  };
}

export function inquiryCohort(data: BusinessData, period: Period): Opportunity[] {
  const tz = data.business.timezone;
  return data.opportunities.filter((o) => isInquiry(o) && instantInPeriod(o.createdAt, period, tz));
}

export interface SalesBreakdown {
  total: number;
  /** De consultas que entraron en el mismo período. */
  deLaCohorte: number;
  /** De consultas de períodos anteriores. */
  deCohortesAnteriores: number;
  /** Ventas sin consulta previa registrada. */
  directas: number;
}

/** Ventas ganadas durante el período, separadas por de dónde vienen. */
export function salesBreakdown(data: BusinessData, period: Period): SalesBreakdown {
  const tz = data.business.timezone;
  const oppById = new Map(data.opportunities.map((o) => [o.id, o]));
  const result: SalesBreakdown = { total: 0, deLaCohorte: 0, deCohortesAnteriores: 0, directas: 0 };
  for (const s of data.sales) {
    if (s.status !== "vigente" || !instantInPeriod(s.wonAt, period, tz)) continue;
    result.total++;
    const o = oppById.get(s.opportunityId);
    if (!o || !isInquiry(o)) result.directas++;
    else if (localDate(o.createdAt, tz) >= period.from) result.deLaCohorte++;
    else result.deCohortesAnteriores++;
  }
  return result;
}
