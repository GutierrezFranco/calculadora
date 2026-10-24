import type { MoneyTotals } from "@/domain/money";

export function formatMoney(totals: MoneyTotals | null | undefined): string {
  if (!totals) return "Sin datos";
  const entries = Object.entries(totals);
  if (entries.length === 0) return "$ 0";
  return entries
    .map(([currency, amount]) =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(
        (amount ?? 0) / 100,
      ),
    )
    .join(" + ");
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "Sin datos" : value.toLocaleString("es-AR");
}

export function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined ? "Sin datos" : `${Math.round(value * 100)} %`;
}

export function formatDateTime(iso: string | null, timezone: string): string {
  if (!iso) return "Nunca";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(
    new Date(iso),
  );
}

/** Convierte "150.000,50" o "150000.50" a centavos. Devuelve null si no es un número. */
export function parseAmount(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  let text = input.trim().replace(/[$\s]/g, "");
  // Con coma decimal (formato argentino) los puntos son separadores de miles.
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}
