import { operationsInPeriod } from "./operations";
import { cohortResult, countInquiries, inquiryCohort, salesBreakdown, type CohortResult, type SalesBreakdown } from "./cohort";
import { eachDay, instantInPeriod } from "./dates";
import { addTo, convert, type MoneyTotals } from "./money";
import { amountRefunded, effectiveSaleAmount } from "./pipeline";
import type { BusinessData, Period } from "./types";

/**
 * Métricas de un período. `null` significa "Sin datos": nunca se reemplaza
 * la falta de información por un cero.
 */
export interface PeriodMetrics {
  period: Period;
  consultasCalificadas: number | null;
  oportunidadesCreadas: number | null;
  /** Ventas vigentes cuyo cierre fue dentro del período (incluye ventas directas). */
  ventasGanadas: number | null;
  /** Las mismas ventas, separadas en de la cohorte, de cohortes anteriores y directas. */
  ventas: SalesBreakdown | null;
  /** Personas distintas con al menos una venta ganada en el período. */
  clientes: number | null;
  facturacionPactada: MoneyTotals | null;
  /** Cobros menos devoluciones con fecha en el período, de cualquier oportunidad. */
  cobrado: MoneyTotals | null;
  /** Lo que falta cobrar hoy de las ventas ganadas en el período. */
  saldoPendiente: MoneyTotals | null;
  /** Venta pactada − costo directo − costos variables, solo de ventas con costo cargado. */
  contribucion: { totals: MoneyTotals; ventasSinCosto: number } | null;
  /**
   * Cierre de la cohorte: de las consultas identificadas que entraron en el período, cuántas
   * se ganaron hasta hoy. Las pendientes están en el denominador; la cobertura dice qué
   * parte de las consultas recibidas está identificada.
   */
  tasaCierre: CohortResult | null;
  ticketPactado: MoneyTotals | null;
  /** Cobrado hasta hoy sobre las ventas ganadas en el período, dividido por esas ventas. */
  ticketCobrado: MoneyTotals | null;
  /** Señas de oportunidades perdidas en el período que no se devolvieron. */
  senasRetenidas: MoneyTotals | null;
  avisos: string[];
}

const EMPTY: Omit<PeriodMetrics, "period" | "avisos"> = {
  consultasCalificadas: null,
  oportunidadesCreadas: null,
  ventasGanadas: null,
  ventas: null,
  clientes: null,
  facturacionPactada: null,
  cobrado: null,
  saldoPendiente: null,
  contribucion: null,
  tasaCierre: null,
  ticketPactado: null,
  ticketCobrado: null,
  senasRetenidas: null,
};

function divideTotals(totals: MoneyTotals, counts: Partial<Record<string, number>>): MoneyTotals {
  const result: MoneyTotals = {};
  for (const [currency, amount] of Object.entries(totals)) {
    const count = counts[currency];
    if (count) result[currency] = Math.round((amount ?? 0) / count);
  }
  return result;
}

export function computeMetrics(data: BusinessData, period: Period): PeriodMetrics {
  const tz = data.business.timezone;
  const within = (instant: string | null) => instant !== null && instantInPeriod(instant, period, tz);
  const avisos: string[] = [];

  const createdOpps = data.opportunities.filter((o) => within(o.createdAt));
  const wonSales = data.sales.filter((s) => s.status === "vigente" && within(s.wonAt));
  const lostOpps = data.opportunities.filter((o) => o.stage === "perdido" && o.lostAt && within(o.lostAt));
  const periodPayments = data.payments.filter((p) => within(p.paidAt));
  const days = new Set(eachDay(period));
  const periodTallies = data.tallies.filter((t) => days.has(t.date));
  const reversedInPeriod = data.adjustments.some((a) => a.kind === "anulacion" && within(a.at));

  const operations = operationsInPeriod(data, period);
  const incompleteWins = operations.filter((o) => o.commercialStatus === "ganada" && !data.sales.some((s) => s.operationId === o.id));
  const hasData =
    operations.length > 0 ||
    createdOpps.length > 0 ||
    wonSales.length > 0 ||
    lostOpps.length > 0 ||
    periodPayments.length > 0 ||
    periodTallies.length > 0 ||
    reversedInPeriod;
  if (!hasData) return { period, ...EMPTY, avisos: ["Sin datos para este período", ...((data.operations ?? []).some((o) => o.occurredAt === null) ? ["Hay operaciones sin fecha: completala para incluirlas en un período"] : [])] };

  const inquiries = countInquiries(data, period);
  avisos.push(...inquiries.avisos);

  const facturacion: MoneyTotals = {};
  const salesPerCurrency: Partial<Record<string, number>> = {};
  const contribucion: MoneyTotals = {};
  const cobradoSobreVentas: MoneyTotals = {};
  const saldo: MoneyTotals = {};
  let ventasSinCosto = 0;
  for (const sale of wonSales) {
    const amount = effectiveSaleAmount(sale, data.adjustments);
    addTo(facturacion, amount);
    salesPerCurrency[amount.currency] = (salesPerCurrency[amount.currency] ?? 0) + 1;

    if (sale.directCost) {
      addTo(contribucion, amount);
      addTo(contribucion, sale.directCost, -1);
      if (sale.variableCosts) addTo(contribucion, sale.variableCosts, -1);
    } else {
      ventasSinCosto++;
    }

    // Un cobro en otra moneda (venta en pesos cobrada en dólares) se convierte
    // con la cotización que estaba cargada cuando se registró el cobro.
    let paid = 0;
    for (const p of data.payments.filter((p) => p.saleId === sale.id || (p.saleId === null && ((p.operationId && p.operationId === sale.operationId) || (!p.operationId && p.opportunityId !== null && p.opportunityId === sale.opportunityId && data.sales.filter((s) => s.opportunityId === sale.opportunityId && s.status === "vigente").length === 1 && (data.operations ?? []).filter((o) => o.opportunityId === sale.opportunityId).length <= 1))))) {
      const converted = convert(p.amount, amount.currency, p.usdRate);
      if (!converted) {
        avisos.push(`Un cobro en ${p.amount.currency} no tiene cotización para descontarse del saldo`);
        continue;
      }
      paid += p.kind === "devolucion" ? -converted.amount : converted.amount;
    }
    addTo(cobradoSobreVentas, { amount: paid, currency: amount.currency });
    addTo(saldo, { amount: Math.max(amount.amount - paid, 0), currency: amount.currency });
  }

  const cobrado: MoneyTotals = {};
  for (const p of periodPayments) addTo(cobrado, p.amount, p.kind === "devolucion" ? -1 : 1);

  const senas: MoneyTotals = {};
  for (const o of lostOpps) {
    for (const p of data.payments.filter((p) => p.opportunityId === o.id && p.kind === "sena")) {
      addTo(senas, { amount: p.amount.amount - amountRefunded(data.payments, p.id), currency: p.amount.currency });
    }
  }

  const ganadas = wonSales.length + incompleteWins.length;
  if (incompleteWins.length) avisos.push(`${incompleteWins.length} operaciones aceptadas sin precio: facturación incompleta`);
  const unknownPaid = operations.filter((o) => !o.paymentKnown);
  if (unknownPaid.length) avisos.push(`${unknownPaid.length} operaciones con cobro desconocido`);
  const undatedPayments = data.payments.filter((p) => p.paidAt === null && operations.some((o) => o.id === p.operationId));
  if (undatedPayments.length) avisos.push("Hay cobros sin fecha: no se asignan al flujo de caja del mes");
  if ((data.operations ?? []).some((o) => o.occurredAt === null)) avisos.push("Hay operaciones sin fecha: revisalas en Operaciones para incluirlas en un período");
  const hayContribucion = ganadas === 0 || ventasSinCosto < wonSales.length;

  return {
    period,
    consultasCalificadas: inquiries.total === 0 && createdOpps.length === 0 && periodTallies.length === 0 ? null : inquiries.total,
    oportunidadesCreadas: createdOpps.length,
    ventasGanadas: ganadas,
    ventas: salesBreakdown(data, period),
    clientes: new Set([...wonSales.map((s) => s.contactId), ...incompleteWins.map((o) => o.contactId)]).size,
    facturacionPactada: incompleteWins.length > 0 && wonSales.length === 0 ? null : facturacion,
    cobrado: periodPayments.length === 0 && (unknownPaid.length > 0 || undatedPayments.length > 0) ? null : cobrado,
    saldoPendiente: unknownPaid.length > 0 || incompleteWins.length > 0 ? null : saldo,
    contribucion: hayContribucion ? { totals: contribucion, ventasSinCosto: ventasSinCosto + incompleteWins.length } : null,
    tasaCierre: cohortResult(inquiryCohort(data, period), data, inquiries.total),
    ticketPactado: ganadas > 0 ? divideTotals(facturacion, salesPerCurrency) : null,
    ticketCobrado: ganadas > 0 && unknownPaid.length === 0 ? divideTotals(cobradoSobreVentas, salesPerCurrency) : null,
    senasRetenidas: senas,
    avisos,
  };
}
