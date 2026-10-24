import type { Instant, LocalDate, Period } from "./types";

/** Fecha local (YYYY-MM-DD) de un instante en la zona horaria del negocio. */
export function localDate(instant: Instant, timezone: string): LocalDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInPeriod(period: Period): number {
  const ms = Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function eachDay(period: Period): LocalDate[] {
  return Array.from({ length: daysInPeriod(period) }, (_, i) => addDays(period.from, i));
}

/** Últimos N días incluyendo hoy (30, 60, 90 en el selector del dashboard). */
export function lastNDays(n: number, today: LocalDate): Period {
  return { from: addDays(today, -(n - 1)), to: today };
}

/** Ventana de igual duración inmediatamente anterior, para comparar. */
export function previousPeriod(period: Period): Period {
  const length = daysInPeriod(period);
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

export function inPeriod(date: LocalDate, period: Period): boolean {
  return date >= period.from && date <= period.to;
}

export function instantInPeriod(instant: Instant, period: Period, timezone: string): boolean {
  return inPeriod(localDate(instant, timezone), period);
}

/** Instante que corresponde a una fecha y hora local del negocio (para cargas con fecha pasada). */
export function instantAt(date: LocalDate, hour: number, timezone: string): Instant {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (shown - guess)).toISOString();
}
