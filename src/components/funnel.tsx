import type { FunnelStep } from "@/domain/funnel";
import { formatCount } from "@/lib/format";

/** Embudo comprimido: cada paso con su conversión desde el anterior. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.count ?? 0), 1);
  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-1 text-sm font-medium">Embudo</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Oportunidades creadas en el período y hasta dónde llegaron hoy. Las consultas siguen la carga diaria.
      </p>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.label} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[11rem_1fr_auto]">
            <span>{step.label}</span>
            <div className="h-3 rounded bg-neutral-100 dark:bg-neutral-900">
              <div className="h-3 rounded bg-neutral-800 dark:bg-neutral-300" style={{ width: `${((step.count ?? 0) / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right tabular-nums">
              {formatCount(step.count)}
              {step.rate !== null && <span className="ml-1 text-xs text-neutral-500">({Math.round(step.rate * 100)} %)</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
