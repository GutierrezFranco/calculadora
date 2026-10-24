import Link from "next/link";
import type { ReactNode } from "react";
import type { PeriodMetrics } from "@/domain/metrics";
import type { MoneyTotals } from "@/domain/money";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";

export const RANGES = [30, 60, 90] as const;

export function parseRange(value: string | string[] | undefined): (typeof RANGES)[number] {
  return RANGES.find((r) => r === Number(value)) ?? 30;
}

/** Variación contra el período anterior, solo si ambos tienen dato. */
function delta(current: number | null | undefined, previous: number | null | undefined): string | null {
  if (current === null || current === undefined || !previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)} % vs. período anterior`;
}

interface Card {
  label: string;
  value: string;
  detail?: string | null;
  hint?: string;
}

function cards(m: PeriodMetrics, prev: PeriodMetrics, currency: string): Card[] {
  const local = (t: MoneyTotals | null | undefined) => t?.[currency] ?? null;
  return [
    {
      label: "Consultas calificadas",
      value: formatCount(m.consultasCalificadas),
      detail: delta(m.consultasCalificadas, prev.consultasCalificadas),
    },
    {
      label: "Clientes",
      value: formatCount(m.clientes),
      detail: delta(m.clientes, prev.clientes),
      hint: "Personas distintas con al menos una venta ganada",
    },
    { label: "Ventas ganadas", value: formatCount(m.ventasGanadas), detail: delta(m.ventasGanadas, prev.ventasGanadas) },
    {
      label: "Facturación pactada",
      value: formatMoney(m.facturacionPactada),
      detail: delta(local(m.facturacionPactada), local(prev.facturacionPactada)),
    },
    {
      label: "Dinero cobrado",
      value: formatMoney(m.cobrado),
      detail: delta(local(m.cobrado), local(prev.cobrado)),
      hint: "Cobros menos devoluciones con fecha en el período",
    },
    {
      label: "Contribución estimada",
      value: formatMoney(m.contribucion?.totals),
      detail: m.contribucion?.ventasSinCosto ? `${m.contribucion.ventasSinCosto} ventas sin costo cargado` : null,
      hint: "Venta pactada − costo directo − costos variables. No es ganancia neta.",
    },
    {
      label: "Tasa de cierre",
      value: formatRatio(m.tasaCierre?.ratio),
      detail: m.tasaCierre
        ? `${m.tasaCierre.ganadas} ganadas · ${m.tasaCierre.perdidas} perdidas · ${m.tasaCierre.pendientes} pendientes`
        : null,
      hint: "Ganadas / (ganadas + perdidas). Las pendientes no cuentan como pérdida.",
    },
    { label: "Ticket promedio pactado", value: formatMoney(m.ticketPactado) },
    { label: "Ticket promedio cobrado", value: formatMoney(m.ticketCobrado) },
    { label: "Saldo pendiente de cobro", value: formatMoney(m.saldoPendiente) },
    {
      label: "Señas retenidas",
      value: formatMoney(m.senasRetenidas),
      hint: "Señas de oportunidades perdidas que no se devolvieron",
    },
  ];
}

export function Dashboard({
  title,
  subtitle,
  metrics,
  previous,
  currency,
  days,
  basePath,
  before,
  after,
}: {
  /** Contenido entre el encabezado y las tarjetas (objetivos). */
  before?: ReactNode;
  /** Contenido debajo de las tarjetas (embudo). */
  after?: ReactNode;
  title: string;
  subtitle?: string;
  metrics: PeriodMetrics;
  previous: PeriodMetrics;
  currency: string;
  days: number;
  basePath: string;
}) {
  const { period } = metrics;
  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          <p className="text-sm text-neutral-500">
            Del {period.from} al {period.to} · comparado con los {days} días anteriores
          </p>
          {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
        </div>
        <nav className="flex gap-2" aria-label="Período">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`${basePath}?dias=${r}`}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                r === days
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              {r} días
            </Link>
          ))}
        </nav>
      </header>

      {before}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards(metrics, previous, currency).map((card) => (
          <article key={card.label} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm text-neutral-500">{card.label}</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
            {card.detail && <p className="mt-1 text-xs text-neutral-500">{card.detail}</p>}
            {card.hint && <p className="mt-2 text-xs text-neutral-400">{card.hint}</p>}
          </article>
        ))}
      </section>

      {after}

      {metrics.avisos.length > 0 && (
        <ul className="mt-6 list-disc pl-5 text-sm text-neutral-500">
          {metrics.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </>
  );
}
