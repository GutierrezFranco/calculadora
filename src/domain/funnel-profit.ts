/**
 * Rentabilidad por embudo en un mes: cuánto se invirtió, qué generó y cuánto se ganó.
 *
 * - Inversión y consultas: lo que el alumno carga por mes en "Publicidad" (null = no lo cargó).
 * - Clientes y facturación: salen de las reparaciones y ventas ganadas del mes con ese origen.
 * - Ganancia = facturado − costo de repuestos/mercadería − inversión del embudo.
 * - Rentabilidad = ganancia ÷ inversión (cuánto ganó por cada $1 que puso en publicidad).
 * Importes en unidades mínimas (centavos) de la moneda del negocio. Lo cargado en dólares se convierte con la
 * cotización guardada en ese registro (o la del negocio); sin cotización no se mezcla y se informa aparte.
 * Embudos no rastreables (tráfico al perfil, orgánico): el pago se mezcla con lo orgánico, así que no hay un
 * costo por cliente real: se muestra la rentabilidad del mes marcada como estimada.
 */

export interface ProfitFunnel {
  id: string;
  name: string;
  /** Embudo pago (anuncios): sin inversión cargada se avisa que falta. */
  paid: boolean;
  /** false = no se puede saber qué cliente trajo el anuncio (tráfico al perfil, orgánico). */
  traceable?: boolean;
}

export interface ProfitMonthInput {
  funnelId: string;
  spend: number | null;
  inquiries: number | null;
  /** Moneda de la inversión; ausente = la del negocio. */
  currency?: string;
  usdRate?: number | null;
  followers?: number | null;
  plays3s?: number | null;
  impressions?: number | null;
}

export interface ProfitOperation {
  funnelId: string | null;
  contactId: string;
  won: boolean;
  amount: number | null;
  cost: number | null;
  collected: number | null;
  currency: string;
  /** Cotización guardada al registrar la venta (moneda local por 1 USD). */
  usdRate?: number | null;
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
  traceable: boolean;
  /** Inversión ÷ seguidores ganados con el anuncio. */
  costPerFollower: number | null;
  /** Reproducciones de 3 segundos ÷ impresiones. */
  hookRate: number | null;
  /** Qué falta cargar para completar este embudo. */
  missing: string[];
}

export interface FunnelProfitReport {
  rows: FunnelProfitRow[];
  total: FunnelProfitRow;
  /** Trabajos o inversiones en otra moneda sin cotización: no se suman. */
  otherCurrency: number;
  /** Importes en dólares convertidos con su cotización. */
  converted: number;
}

const ratio = (a: number, b: number | null) => (b ? a / b : null);

type MonthValues = { spend: number | null; inquiries: number | null; followers?: number | null; plays3s?: number | null; impressions?: number | null };

function build(
  funnelId: string | null,
  name: string,
  paid: boolean,
  month: MonthValues | undefined,
  ops: ProfitOperation[],
  traceable = true,
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
    // Sin trazabilidad, dividir la inversión por los clientes da un número que engaña.
    costPerClient: spend !== null && traceable ? ratio(spend, clients) : null,
    roi: spend ? profit / spend : null,
    traceable,
    costPerFollower: spend !== null && month?.followers ? spend / month.followers : null,
    hookRate: month?.plays3s != null && month?.impressions ? month.plays3s / month.impressions : null,
    missing,
  };
}

export function computeFunnelProfit(input: {
  funnels: ProfitFunnel[];
  months: ProfitMonthInput[];
  operations: ProfitOperation[];
  currency: string;
  /** Cotización del negocio, para lo que no guardó la suya. */
  usdRate?: number | null;
}): FunnelProfitReport {
  let otherCurrency = 0;
  let converted = 0;
  // A moneda del negocio: USD con su cotización; sin cotización (u otra moneda) no se convierte.
  const toLocal = (amount: number | null, currency: string | undefined, rate: number | null | undefined): number | null | undefined => {
    if (amount === null || !currency || currency === input.currency) return amount;
    const r = rate ?? input.usdRate;
    if (currency !== "USD" || !r) return undefined;
    converted++;
    return Math.round(amount * r);
  };
  const ops: ProfitOperation[] = [];
  for (const o of input.operations) {
    const amount = toLocal(o.amount, o.currency, o.usdRate);
    const cost = toLocal(o.cost, o.currency, o.usdRate);
    const collected = toLocal(o.collected, o.currency, o.usdRate);
    if (amount === undefined || cost === undefined || collected === undefined) {
      if (o.won) otherCurrency++;
      continue;
    }
    ops.push({ ...o, amount, cost, collected, currency: input.currency });
  }
  const months: ProfitMonthInput[] = [];
  for (const m of input.months) {
    const spend = toLocal(m.spend, m.currency, m.usdRate);
    if (spend === undefined) {
      otherCurrency++;
      continue;
    }
    months.push({ ...m, spend });
  }
  const monthOf = new Map(months.map((m) => [m.funnelId, m]));
  const known = new Set(input.funnels.map((f) => f.id));
  const rows = input.funnels
    .map((f) => build(f.id, f.name, f.paid, monthOf.get(f.id), ops.filter((o) => o.funnelId === f.id), f.traceable ?? true))
    // Se muestran los embudos con algo cargado en el mes (o pagos, para avisar qué falta)
    .filter((r) => r.jobs > 0 || r.spend !== null || r.inquiries !== null);
  const unattributed = ops.filter((o) => !o.funnelId || !known.has(o.funnelId));
  if (unattributed.some((o) => o.won)) rows.push(build(null, "No sé / sin origen", false, undefined, unattributed));

  const spends = months.filter((m) => known.has(m.funnelId));
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
  return { rows: rows.sort((a, b) => b.profit - a.profit), total, otherCurrency, converted };
}

/** Plantillas cuyos clientes no se pueden atribuir a un anuncio concreto. */
export const NON_TRACEABLE_TEMPLATES = ["meta_perfil", "instagram_organico", "tiktok_organico"];
