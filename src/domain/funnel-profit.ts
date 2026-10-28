/**
 * Rentabilidad por embudo en un mes: cuánto se invirtió, qué generó y cuánto se ganó.
 *
 * - Inversión y consultas: lo que el alumno carga por mes en "Publicidad" (null = no lo cargó).
 * - Clientes y facturación: salen de las reparaciones y ventas ganadas del mes con ese origen.
 * - Ganancia = facturado − costo de repuestos/mercadería − inversión del embudo.
 * - Rentabilidad = ganancia ÷ inversión (cuánto ganó por cada $1 que puso en publicidad).
 * Importes en unidades mínimas (centavos) de la moneda del negocio; otras monedas se informan aparte.
 */

export interface ProfitFunnel {
  id: string;
  name: string;
  /** Embudo pago (anuncios): sin inversión cargada se avisa que falta. */
  paid: boolean;
}

export interface ProfitMonthInput {
  funnelId: string;
  spend: number | null;
  inquiries: number | null;
}

export interface ProfitOperation {
  funnelId: string | null;
  contactId: string;
  won: boolean;
  amount: number | null;
  cost: number | null;
  collected: number | null;
  currency: string;
}

export interface FunnelProfitRow {
  funnelId: string | null;
  name: string;
  paid: boolean;
  spend: number | null;
  inquiries: number | null;
  clients: number;
  jobs: number;
  billed: number;
  collected: number;
  cost: number;
  /** Trabajos ganados sin precio cargado (no suman a la facturación). */
  withoutPrice: number;
  /** Trabajos ganados sin costo cargado (la ganancia puede ser menor). */
  withoutCost: number;
  profit: number;
  closeRate: number | null;
  costPerInquiry: number | null;
  costPerClient: number | null;
  /** Ganancia por cada 1 invertido (0,5 = 50 %). null si no hubo inversión. */
  roi: number | null;
  /** Qué falta cargar para completar este embudo. */
  missing: string[];
}

export interface FunnelProfitReport {
  rows: FunnelProfitRow[];
  total: FunnelProfitRow;
  /** Trabajos en otra moneda: no se mezclan con los de la moneda del negocio. */
  otherCurrency: number;
}

const ratio = (a: number, b: number | null) => (b ? a / b : null);

function build(
  funnelId: string | null,
  name: string,
  paid: boolean,
  month: { spend: number | null; inquiries: number | null } | undefined,
  ops: ProfitOperation[],
): FunnelProfitRow {
  const won = ops.filter((o) => o.won);
  const spend = month?.spend ?? null;
  const inquiries = month?.inquiries ?? null;
  const clients = new Set(won.map((o) => o.contactId)).size;
  const billed = won.reduce((s, o) => s + (o.amount ?? 0), 0);
  const cost = won.reduce((s, o) => s + (o.cost ?? 0), 0);
  const collected = won.reduce((s, o) => s + (o.collected ?? 0), 0);
  const profit = billed - cost - (spend ?? 0);
  const missing: string[] = [];
  if (paid && spend === null) missing.push("inversión");
  if (paid && inquiries === null) missing.push("consultas");
  return {
    funnelId,
    name,
    paid,
    spend,
    inquiries,
    clients,
    jobs: won.length,
    billed,
    collected,
    cost,
    withoutPrice: won.filter((o) => o.amount === null).length,
    withoutCost: won.filter((o) => o.cost === null).length,
    profit,
    closeRate: inquiries ? Math.min(1, clients / inquiries) : null,
    costPerInquiry: spend !== null ? ratio(spend, inquiries) : null,
    costPerClient: spend !== null ? ratio(spend, clients) : null,
    roi: spend ? profit / spend : null,
    missing,
  };
}

export function computeFunnelProfit(input: {
  funnels: ProfitFunnel[];
  months: ProfitMonthInput[];
  operations: ProfitOperation[];
  currency: string;
}): FunnelProfitReport {
  const ops = input.operations.filter((o) => o.currency === input.currency);
  const otherCurrency = input.operations.filter((o) => o.won && o.currency !== input.currency).length;
  const monthOf = new Map(input.months.map((m) => [m.funnelId, m]));
  const known = new Set(input.funnels.map((f) => f.id));
  const rows = input.funnels
    .map((f) => build(f.id, f.name, f.paid, monthOf.get(f.id), ops.filter((o) => o.funnelId === f.id)))
    // Se muestran los embudos con algo cargado en el mes (o pagos, para avisar qué falta)
    .filter((r) => r.jobs > 0 || r.spend !== null || r.inquiries !== null);
  const unattributed = ops.filter((o) => !o.funnelId || !known.has(o.funnelId));
  if (unattributed.some((o) => o.won)) rows.push(build(null, "No sé / sin origen", false, undefined, unattributed));

  const spends = input.months.filter((m) => known.has(m.funnelId));
  const anySpend = spends.some((m) => m.spend !== null);
  const anyInquiries = spends.some((m) => m.inquiries !== null);
  const total = build(
    null,
    "Total",
    false,
    {
      spend: anySpend ? spends.reduce((s, m) => s + (m.spend ?? 0), 0) : null,
      inquiries: anyInquiries ? spends.reduce((s, m) => s + (m.inquiries ?? 0), 0) : null,
    },
    ops,
  );
  return { rows: rows.sort((a, b) => b.profit - a.profit), total, otherCurrency };
}
