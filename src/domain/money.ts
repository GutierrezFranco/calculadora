import type { CurrencyCode, Money } from "./types";

/** Totales separados por moneda: nunca se suman monedas distintas sin conversión. */
export type MoneyTotals = Partial<Record<CurrencyCode, number>>;

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(`El importe debe estar en unidades mínimas enteras: ${amount}`);
  }
  return { amount, currency };
}

export function addTo(totals: MoneyTotals, value: Money, sign: 1 | -1 = 1): MoneyTotals {
  totals[value.currency] = (totals[value.currency] ?? 0) + sign * value.amount;
  return totals;
}

export function sumMoney(values: Money[]): MoneyTotals {
  return values.reduce<MoneyTotals>((totals, value) => addTo(totals, value), {});
}

export function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`No se pueden combinar ${a.currency} y ${b.currency} sin conversión explícita`);
  }
}

/**
 * Convierte totales a USD con cotizaciones explícitas (unidades locales por 1 USD).
 * Devuelve null si falta la cotización de alguna moneda presente.
 */
export function totalsInUsd(
  totals: MoneyTotals,
  ratesPerUsd: Partial<Record<CurrencyCode, number>>,
): number | null {
  let usd = 0;
  for (const [currency, amount] of Object.entries(totals)) {
    if (!amount) continue;
    const rate = currency === "USD" ? 1 : ratesPerUsd[currency];
    if (!rate) return null;
    usd += amount / rate;
  }
  return Math.round(usd);
}

/**
 * Convierte entre la moneda local del negocio y USD con la cotización guardada
 * en el registro (moneda local por 1 USD). Devuelve null si no se puede.
 */
export function convert(value: Money, to: CurrencyCode, usdRate: number | null): Money | null {
  if (value.currency === to) return value;
  if (!usdRate) return null;
  if (value.currency === "USD") return { amount: Math.round(value.amount * usdRate), currency: to };
  if (to === "USD") return { amount: Math.round(value.amount / usdRate), currency: to };
  return null;
}

/** Convierte "150.000,50", "150000.50" o "$ 20000" a centavos. null si está vacío, es negativo o no es un número. */
export function parseAmountText(input: string): number | null {
  if (input.trim() === "") return null;
  let text = input.trim().replace(/[$\s]/g, "");
  // Con coma decimal (formato argentino) los puntos son separadores de miles.
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}
