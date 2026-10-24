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
