import Link from "next/link";
import { Suspense } from "react";
import { lastNDays, localDate, previousPeriod } from "@/domain/dates";
import { computeMetrics, type PeriodMetrics } from "@/domain/metrics";
import type { MoneyTotals } from "@/domain/money";
import { demoData } from "@/lib/demo-data";

const RANGES = [30, 60, 90] as const;

function formatMoney(totals: MoneyTotals | null | undefined): string {
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

function formatCount(value: number | null): string {
  return value === null ? "Sin datos" : value.toLocaleString("es-AR");
}

function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined ? "Sin datos" : `${Math.round(value * 100)} %`;
}

/** Variación contra el período anterior, solo si ambos tienen dato en ARS. */
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

function cards(m: PeriodMetrics, prev: PeriodMetrics): Card[] {
  const ars = (t: MoneyTotals | null | undefined) => t?.ARS ?? null;
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
      detail: delta(ars(m.facturacionPactada), ars(prev.facturacionPactada)),
    },
    {
      label: "Dinero cobrado",
      value: formatMoney(m.cobrado),
      detail: delta(ars(m.cobrado), ars(prev.cobrado)),
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
    { label: "Señas retenidas", value: formatMoney(m.senasRetenidas), hint: "Señas de oportunidades perdidas que no se devolvieron" },
  ];
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-6xl px-4 py-10 text-neutral-500">Cargando…</main>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const requested = Number((await searchParams).dias);
  const days = RANGES.find((r) => r === requested) ?? 30;

  const today = localDate(new Date().toISOString(), "America/Argentina/Buenos_Aires");
  const data = demoData(today);
  const period = lastNDays(days, today);
  const metrics = computeMetrics(data, period);
  const previous = computeMetrics(data, previousPeriod(period));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Vista previa con <strong>datos de ejemplo ficticios</strong>. Todavía no hay login ni carga de datos.
      </div>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">MDM OS</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{data.business.name}</h1>
          <p className="text-sm text-neutral-500">
            Del {period.from} al {period.to} · comparado con los {days} días anteriores
          </p>
        </div>
        <nav className="flex gap-2" aria-label="Período">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/?dias=${r}`}
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

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards(metrics, previous).map((card) => (
          <article
            key={card.label}
            className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            title={card.hint}
          >
            <h2 className="text-sm text-neutral-500">{card.label}</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
            {card.detail && <p className="mt-1 text-xs text-neutral-500">{card.detail}</p>}
            {card.hint && <p className="mt-2 text-xs text-neutral-400">{card.hint}</p>}
          </article>
        ))}
      </section>

      {metrics.avisos.length > 0 && (
        <ul className="mt-6 list-disc pl-5 text-sm text-neutral-500">
          {metrics.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
