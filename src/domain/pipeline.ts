import { money, sameCurrency } from "./money";
import type {
  Actor,
  Instant,
  Money,
  Opportunity,
  Payment,
  Sale,
  SaleAdjustment,
  Stage,
} from "./types";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "nueva_consulta", label: "Nueva consulta" },
  { id: "presupuestado", label: "Presupuestado" },
  { id: "en_seguimiento", label: "En seguimiento" },
  { id: "senado", label: "Señado" },
  { id: "ganado_en_reparacion", label: "Ganado / en reparación" },
  { id: "ganado_completado", label: "Ganado / completado" },
  { id: "perdido", label: "Perdido" },
];

export const WON_STAGES: Stage[] = ["ganado_en_reparacion", "ganado_completado"];

export function isWonStage(stage: Stage): boolean {
  return WON_STAGES.includes(stage);
}

export function isOpen(opportunity: Opportunity): boolean {
  return !isWonStage(opportunity.stage) && opportunity.stage !== "perdido";
}

/**
 * Oportunidades abiertas del contacto. Si hay alguna, la pantalla pregunta si el
 * mensaje nuevo es la misma necesidad (no se crea otra) o una distinta.
 */
export function openOpportunitiesFor(contactId: string, opportunities: Opportunity[]): Opportunity[] {
  return opportunities.filter((o) => o.contactId === contactId && isOpen(o));
}

/**
 * Valida un cambio de etapa. Ganar requiere una venta registrada y solo el
 * usuario confirma ganados y pérdidas: la IA o una importación únicamente sugieren.
 */
export function assertStageChange(
  from: Stage,
  to: Stage,
  context: { actor: Actor; hasSale: boolean },
): void {
  if (from === to) return;
  const confirmsOutcome = isWonStage(to) || to === "perdido";
  if (confirmsOutcome && context.actor === "ia") {
    throw new Error("La IA no puede confirmar ganados ni pérdidas: solo sugerirlos");
  }
  if (isWonStage(to) && !context.hasSale) {
    throw new Error("Para pasar a ganado hay que registrar la venta con su monto pactado");
  }
  if (isWonStage(from) && !isWonStage(to) && context.hasSale) {
    throw new Error("Una venta ganada no se mueve de etapa: se revierte con un ajuste");
  }
}

/** Monto pactado vigente: original más ajustes; 0 si la venta fue revertida. */
export function effectiveSaleAmount(sale: Sale, adjustments: SaleAdjustment[]): Money {
  if (sale.status === "revertida") return money(0, sale.amount.currency);
  const delta = adjustments
    .filter((a) => a.saleId === sale.id)
    .reduce((sum, a) => {
      sameCurrency(a.amountDelta, sale.amount);
      return sum + a.amountDelta.amount;
    }, 0);
  return money(sale.amount.amount + delta, sale.amount.currency);
}

export function amountRefunded(payments: Payment[], paymentId: string): number {
  return payments
    .filter((p) => p.kind === "devolucion" && p.refundsPaymentId === paymentId)
    .reduce((sum, p) => sum + p.amount.amount, 0);
}

/**
 * Registra la devolución de un cobro. No borra el cobro original y no permite
 * devolver más de lo que se cobró, así una devolución nunca se cuenta dos veces.
 */
export function refundPayment(
  original: Payment,
  payments: Payment[],
  input: { id: string; amount: number; at: Instant },
): Payment {
  if (original.kind === "devolucion") throw new Error("No se puede devolver una devolución");
  const remaining = original.amount.amount - amountRefunded(payments, original.id);
  if (input.amount <= 0 || input.amount > remaining) {
    throw new Error(`Devolución inválida: quedan ${remaining} por devolver de ese cobro`);
  }
  return {
    id: input.id,
    businessId: original.businessId,
    opportunityId: original.opportunityId,
    saleId: original.saleId,
    amount: money(input.amount, original.amount.currency),
    kind: "devolucion",
    paidAt: input.at,
    refundsPaymentId: original.id,
    usdRate: original.usdRate,
  };
}

/**
 * Revierte una venta: la marca revertida con un ajuste de anulación y, si se pide,
 * devuelve todo lo cobrado. La venta y los cobros originales se conservan.
 */
export function reverseSale(
  sale: Sale,
  payments: Payment[],
  input: { adjustmentId: string; at: Instant; reason: string; refund: boolean; newId: () => string },
): { sale: Sale; adjustment: SaleAdjustment; refunds: Payment[] } {
  if (sale.status === "revertida") throw new Error("La venta ya está revertida");
  const refunds: Payment[] = [];
  if (input.refund) {
    let ledger = payments;
    for (const p of payments.filter((p) => p.opportunityId === sale.opportunityId && p.kind !== "devolucion")) {
      const remaining = p.amount.amount - amountRefunded(ledger, p.id);
      if (remaining <= 0) continue;
      const refund = refundPayment(p, ledger, { id: input.newId(), amount: remaining, at: input.at });
      refunds.push(refund);
      ledger = [...ledger, refund];
    }
  }
  return {
    sale: { ...sale, status: "revertida" },
    adjustment: {
      id: input.adjustmentId,
      saleId: sale.id,
      kind: "anulacion",
      amountDelta: money(-sale.amount.amount, sale.amount.currency),
      at: input.at,
      reason: input.reason,
    },
    refunds,
  };
}
