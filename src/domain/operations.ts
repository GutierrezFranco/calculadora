import type { BusinessData, Instant, LocalDate, Period } from "./types";
import { instantInPeriod } from "./dates";

export type CommercialStatus = "pendiente" | "ganada" | "perdida" | "cancelada";
export type WorkStatus = "sin_dato" | "pendiente" | "en_trabajo" | "entregado";
export interface Operation {
  id: string;
  contactId: string;
  opportunityId: string | null;
  occurredAt: Instant | null;
  kind: "reparacion" | "venta";
  description: string;
  brand: string | null;
  model: string | null;
  reference: string | null;
  commercialStatus: CommercialStatus;
  workStatus: WorkStatus;
  agreedAmount: number | null;
  currency: string;
  directCost: number | null;
  paymentKnown: boolean;
  funnelId: string | null;
  version: number;
}

export const COMMERCIAL_LABELS: Record<CommercialStatus, string> = {
  pendiente: "Pendiente de confirmar", ganada: "Aceptada / ganada", perdida: "Perdida", cancelada: "Cancelada",
};
export const WORK_LABELS: Record<WorkStatus, string> = {
  sin_dato: "No sé / Sin dato", pendiente: "Pendiente", en_trabajo: "En reparación", entregado: "Entregado",
};

/** Solo suma movimientos de la operación; una seña sin distribuir no se adjudica a varios trabajos. */
export function operationPaid(op: Operation, data: BusinessData): number | null {
  const saleIds = new Set(data.sales.filter((s) => s.operationId === op.id).map((s) => s.id));
  const payments = data.payments.filter((p) => p.operationId === op.id || (p.saleId !== null && saleIds.has(p.saleId)));
  if (!op.paymentKnown && payments.length === 0) return null;
  if (payments.some((p) => p.amount.currency !== op.currency)) return null;
  return payments.reduce((n, p) => n + (p.kind === "devolucion" ? -p.amount.amount : p.amount.amount), 0);
}

export function paymentLabel(op: Operation, paid: number | null): string {
  if (paid === null) return "Cobro desconocido";
  if (paid === 0) return "Sin cobrar (informado)";
  if (op.agreedAmount === null) return "Cobro informado · precio desconocido";
  return paid >= op.agreedAmount ? "Cobrado completo" : "Cobrado parcial";
}

export function operationsInPeriod(data: BusinessData, period: Period): Operation[] {
  return (data.operations ?? []).filter((o) => o.occurredAt && instantInPeriod(o.occurredAt, period, data.business.timezone));
}

export function validLocalDate(value: string, today: LocalDate): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
