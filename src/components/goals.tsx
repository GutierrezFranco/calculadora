import Link from "next/link";
import { daysInPeriod } from "@/domain/dates";
import type { PeriodMetrics } from "@/domain/metrics";
import type { MonthlyGoals } from "@/lib/data";
import { formatCount, formatMoney } from "@/lib/format";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * Avance del mes contra los objetivos. La referencia de ritmo es la parte del mes
 * que ya pasó: llegar al 50 % el día 15 es ir bien.
 */
export function GoalsProgress({
  goals,
  monthToDate,
  monthEnd,
  currency,
  settingsHref,
}: {
  goals: MonthlyGoals;
  monthToDate: PeriodMetrics;
  monthEnd: string;
  currency: string;
  settingsHref: string;
}) {
  const { from, to } = monthToDate.period;
  const monthName = MONTHS[Number(from.slice(5, 7)) - 1];
  const pace = daysInPeriod({ from, to }) / daysInPeriod({ from, to: monthEnd });
  const rows = [
    {
      label: "Facturación",
      goal: goals.facturacion,
      actual: monthToDate.facturacionPactada ? (monthToDate.facturacionPactada[currency] ?? 0) : null,
      format: (v: number) => formatMoney({ [currency]: v }),
    },
    { label: "Ventas", goal: goals.ventas, actual: monthToDate.ventasGanadas, format: formatCount },
    { label: "Consultas", goal: goals.consultas, actual: monthToDate.consultasCalificadas, format: formatCount },
  ].filter((r) => r.goal);

  if (rows.length === 0) {
    return (
      <p className="mb-6 text-sm text-neutral-500">
        Sin objetivos para {monthName}.{" "}
        <Link href={settingsHref} className="underline">
          Cargar objetivos
        </Link>
      </p>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-medium">
        Objetivos de {monthName} <span className="font-normal text-neutral-500">· pasó el {Math.round(pace * 100)} % del mes</span>
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {rows.map((r) => {
          const ratio = r.actual === null ? null : r.actual / r.goal!;
          return (
            <div key={r.label}>
              <div className="flex justify-between text-sm">
                <span>{r.label}</span>
                <span className="tabular-nums text-neutral-500">{ratio === null ? "Sin datos" : `${Math.round(ratio * 100)} %`}</span>
              </div>
              <div className="relative mt-1 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div className="h-2 rounded-full bg-neutral-900 dark:bg-white" style={{ width: `${Math.min((ratio ?? 0) * 100, 100)}%` }} />
                <div className="absolute top-[-3px] h-3.5 w-0.5 bg-neutral-500" style={{ left: `${pace * 100}%` }} title="Ritmo esperado a hoy" />
              </div>
              <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                {r.actual === null ? "Sin datos" : r.format(r.actual)} de {r.format(r.goal!)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
