import { eachDay, instantInPeriod, localDate } from "./dates";
import { addTo, convert, type MoneyTotals } from "./money";
import { amountRefunded, effectiveSaleAmount } from "./pipeline";
import type { BusinessData, InquiryTally, LocalDate, Period } from "./types";

/**
 * Métricas de un período. `null` significa "Sin datos": nunca se reemplaza
 * la falta de información por un cero.
 */
export interface PeriodMetrics {
  period: Period;
  consultasCalificadas: number | null;
  oportunidadesCreadas: number | null;
  /** Ventas vigentes cuyo cierre fue dentro del período. */
  ventasGanadas: number | null;
  /** Personas distintas con al menos una venta ganada en el período. */
  clientes: number | null;
  facturacionPactada: MoneyTotals | null;
  /** Cobros menos devoluciones con fecha en el período, de cualquier oportunidad. */
  cobrado: MoneyTotals | null;
  /** Lo que falta cobrar hoy de las ventas ganadas en el período. */
  saldoPendiente: MoneyTotals | null;
  /** Venta pactada − costo directo − costos variables, solo de ventas con costo cargado. */
  contribucion: { totals: MoneyTotals; ventasSinCosto: number } | null;
  tasaCierre: {
    /** ganadas / (ganadas + perdidas); null si no hubo oportunidades decididas. */
    ratio: number | null;
    ganadas: number;
    perdidas: number;
    /** Abiertas al cierre del período: no cuentan como pérdida. */
    pendientes: number;
  } | null;
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
  const within = (instant: string) => instantInPeriod(instant, period, tz);
  const avisos: string[] = [];

  const createdOpps = data.opportunities.filter((o) => within(o.createdAt));
  const wonSales = data.sales.filter((s) => s.status === "vigente" && within(s.wonAt));
  const lostOpps = data.opportunities.filter((o) => o.stage === "perdido" && o.lostAt && within(o.lostAt));
  const periodPayments = data.payments.filter((p) => within(p.paidAt));
  const days = new Set(eachDay(period));
  const periodTallies = data.tallies.filter((t) => days.has(t.date));
  const reversedInPeriod = data.adjustments.some((a) => a.kind === "anulacion" && within(a.at));

  const hasData =
    createdOpps.length > 0 ||
    wonSales.length > 0 ||
    lostOpps.length > 0 ||
    periodPayments.length > 0 ||
    periodTallies.length > 0 ||
    reversedInPeriod;
  if (!hasData) return { period, ...EMPTY, avisos: ["Sin datos para este período"] };

  // Consultas: el total diario cargado manda sobre las oportunidades de ese día,
  // así no se cuentan dos veces cuando coexisten ambos registros.
  // Si un día tiene totales de varias fuentes, manda el manual, después el importado
  // y por último el detectado desde WhatsApp: nunca se suman entre sí.
  const priority: Record<InquiryTally["method"], number> = { manual: 0, importado: 1, whatsapp: 2 };
  const chosen = new Map<LocalDate, InquiryTally>();
  for (const t of periodTallies) {
    const current = chosen.get(t.date);
    if (!current || priority[t.method] < priority[current.method]) chosen.set(t.date, t);
  }
  const talliesByDay = new Map<LocalDate, number>([...chosen].map(([day, t]) => [day, t.count]));
  const oppsByDay = new Map<LocalDate, number>();
  for (const o of createdOpps) {
    const day = localDate(o.createdAt, tz);
    oppsByDay.set(day, (oppsByDay.get(day) ?? 0) + 1);
  }
  let consultas = 0;
  for (const day of days) {
    const tally = talliesByDay.get(day);
    const opps = oppsByDay.get(day) ?? 0;
    if (tally === undefined) {
      consultas += opps;
    } else {
      consultas += tally;
      if (opps > tally) {
        avisos.push(`${day}: hay ${opps} oportunidades creadas pero el total cargado es ${tally}`);
      }
    }
  }

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
    for (const p of data.payments.filter((p) => p.opportunityId === sale.opportunityId)) {
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

  // Pendientes: creadas hasta el fin del período y sin decidir a esa fecha.
  const decidedBy = (instant: string | null | undefined) =>
    instant !== null && instant !== undefined && localDate(instant, tz) <= period.to;
  const saleByOpp = new Map(data.sales.filter((s) => s.status === "vigente").map((s) => [s.opportunityId, s]));
  const pendientes = data.opportunities.filter((o) => {
    if (localDate(o.createdAt, tz) > period.to) return false;
    if (decidedBy(saleByOpp.get(o.id)?.wonAt)) return false;
    return !(o.stage === "perdido" && decidedBy(o.lostAt));
  }).length;

  const ganadas = wonSales.length;
  const perdidas = lostOpps.length;
  const hayContribucion = ganadas === 0 || ventasSinCosto < ganadas;

  return {
    period,
    consultasCalificadas: consultas,
    oportunidadesCreadas: createdOpps.length,
    ventasGanadas: ganadas,
    clientes: new Set(wonSales.map((s) => s.contactId)).size,
    facturacionPactada: facturacion,
    cobrado,
    saldoPendiente: saldo,
    contribucion: hayContribucion ? { totals: contribucion, ventasSinCosto } : null,
    tasaCierre: {
      ratio: ganadas + perdidas > 0 ? ganadas / (ganadas + perdidas) : null,
      ganadas,
      perdidas,
      pendientes,
    },
    ticketPactado: ganadas > 0 ? divideTotals(facturacion, salesPerCurrency) : null,
    ticketCobrado: ganadas > 0 ? divideTotals(cobradoSobreVentas, salesPerCurrency) : null,
    senasRetenidas: senas,
    avisos,
  };
}
