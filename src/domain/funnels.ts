import { operationsInPeriod } from "./operations";
// Resultados por embudo (docs/arquitectura-v1-3.md §2). Cada oportunidad tiene un solo
// embudo principal y la venta lo hereda: operaciones y facturación suman exacto entre
// embudos. Un cliente con ventas en dos embudos aparece en ambos, así que los clientes
// únicos del negocio se informan aparte.
import { cohortResult, countInquiries, isInquiry, type CohortResult } from "./cohort";
import { inPeriod, instantInPeriod } from "./dates";
import { addTo, type MoneyTotals } from "./money";
import { effectiveSaleAmount } from "./pipeline";
import type { BusinessData, Funnel, FunnelActivity, FunnelStepDef, FunnelVersion, LocalDate, Period } from "./types";

export interface StepTotal extends FunnelStepDef {
  value: number;
  /** estimado si al menos un registro del período se cargó como estimado. */
  quality: "real" | "estimado";
}

export interface VersionActivity {
  version: FunnelVersion;
  records: number;
  steps: StepTotal[];
}

export interface FunnelResult {
  /** null = Sin atribuir. */
  funnel: Funnel | null;
  /** Consultas identificadas del embudo creadas en el período. */
  consultas: number;
  cohort: CohortResult;
  /** Operaciones ganadas en el período, incluidas las directas. */
  ventas: number;
  ventasDirectas: number;
  clientes: number;
  facturacion: MoneyTotals;
  /** Actividad del período por versión de los pasos; la más nueva primero. */
  actividad: VersionActivity[];
}

export interface FunnelReport {
  rows: FunnelResult[];
  sinAtribuir: FunnelResult & {
    /** Consultas que entraron solo como total del día, sin identificar. */
    sinIdentificar: number;
  };
  totals: {
    consultas: number;
    ventas: number;
    /** Personas distintas: no es la suma de los clientes por embudo. */
    clientesUnicos: number;
    facturacion: MoneyTotals;
  };
}

/** Versión de los pasos vigente en una fecha (la primera cubre todo lo anterior). */
export function versionAt(funnel: Funnel, date: LocalDate): FunnelVersion | undefined {
  const sorted = [...funnel.versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return [...sorted].reverse().find((v) => v.validFrom <= date) ?? sorted[0];
}

export function activityFor(funnel: Funnel, activities: FunnelActivity[], period: Period): VersionActivity[] {
  const byVersion = new Map<string, FunnelActivity[]>();
  for (const a of activities) {
    if (a.funnelId !== funnel.id || !inPeriod(a.occurredOn, period)) continue;
    byVersion.set(a.versionId, [...(byVersion.get(a.versionId) ?? []), a]);
  }
  return funnel.versions
    .filter((v) => byVersion.has(v.id))
    .sort((a, b) => b.version - a.version)
    .map((version) => {
      const records = byVersion.get(version.id)!;
      return {
        version,
        records: records.length,
        steps: version.steps.map((step) => {
          const withValue = records.filter((r) => typeof r.values[step.key] === "number");
          return {
            ...step,
            value: withValue.reduce((sum, r) => sum + r.values[step.key], 0),
            quality: withValue.some((r) => r.quality === "estimado") ? ("estimado" as const) : ("real" as const),
          };
        }),
      };
    });
}

export function computeFunnelReport(data: BusinessData, period: Period): FunnelReport {
  const tz = data.business.timezone;
  const funnels = data.funnels ?? [];
  const oppById = new Map(data.opportunities.map((o) => [o.id, o]));
  const keyOf = (funnelId: string | null | undefined) => funnelId ?? "";

  const cohorts = new Map<string, typeof data.opportunities>();
  for (const o of data.opportunities) {
    if (!isInquiry(o) || !instantInPeriod(o.createdAt, period, tz)) continue;
    const k = keyOf(o.funnelId);
    cohorts.set(k, [...(cohorts.get(k) ?? []), o]);
  }

  type Acc = { ventas: number; directas: number; contacts: Set<string>; facturacion: MoneyTotals };
  const sales = new Map<string, Acc>();
  const allContacts = new Set<string>();
  const total: MoneyTotals = {};
  let totalVentas = 0;
  for (const s of data.sales) {
    if (s.status !== "vigente" || !instantInPeriod(s.wonAt, period, tz)) continue;
    const o = oppById.get(s.opportunityId ?? "");
    const operation = (data.operations ?? []).find((op) => op.id === s.operationId);
    const k = keyOf(operation ? operation.funnelId : o?.funnelId);
    const acc = sales.get(k) ?? { ventas: 0, directas: 0, contacts: new Set(), facturacion: {} };
    acc.ventas++;
    if (!o || !isInquiry(o)) acc.directas++;
    acc.contacts.add(s.contactId);
    const amount = effectiveSaleAmount(s, data.adjustments);
    addTo(acc.facturacion, amount);
    addTo(total, amount);
    allContacts.add(s.contactId);
    totalVentas++;
    sales.set(k, acc);
  }

  for (const op of operationsInPeriod(data, period)) {
    if (op.commercialStatus !== "ganada" || data.sales.some((s) => s.operationId === op.id)) continue;
    const k = keyOf(op.funnelId);
    const acc = sales.get(k) ?? { ventas: 0, directas: 0, contacts: new Set<string>(), facturacion: {} };
    acc.ventas++; if (!op.opportunityId) acc.directas++;
    acc.contacts.add(op.contactId); allContacts.add(op.contactId); totalVentas++; sales.set(k, acc);
  }
  const result = (funnel: Funnel | null, recibidasExtra = 0): FunnelResult => {
    const k = keyOf(funnel?.id);
    const cohort = cohorts.get(k) ?? [];
    const acc = sales.get(k);
    return {
      funnel,
      consultas: cohort.length + recibidasExtra,
      cohort: cohortResult(cohort, data, cohort.length + recibidasExtra),
      ventas: acc?.ventas ?? 0,
      ventasDirectas: acc?.directas ?? 0,
      clientes: acc?.contacts.size ?? 0,
      facturacion: acc?.facturacion ?? {},
      actividad: funnel ? activityFor(funnel, data.activities ?? [], period) : [],
    };
  };

  const inquiries = countInquiries(data, period);
  const sinIdentificar = Math.max(inquiries.total - inquiries.identificadas, 0);
  const visible = funnels.filter((f) => f.status !== "archivado" || cohorts.has(f.id) || sales.has(f.id));
  return {
    rows: visible.map((f) => result(f)),
    sinAtribuir: { ...result(null, sinIdentificar), sinIdentificar },
    totals: { consultas: inquiries.total, ventas: totalVentas, clientesUnicos: allContacts.size, facturacion: total },
  };
}

/** Proporción de un paso respecto del anterior (o de la consulta respecto del último paso). */
export function stepRate(value: number | null, previous: number | null): number | null {
  return value === null || previous === null || previous === 0 ? null : value / previous;
}
