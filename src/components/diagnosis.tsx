import type { Finding, Severity } from "@/domain/diagnosis";

const STYLE: Record<Severity, string> = {
  alta: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  media: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  info: "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900",
};
const LABEL: Record<Severity, string> = { alta: "Prioridad alta", media: "Atención", info: "Para mejorar" };

/** Diagnóstico de cuellos de botella con la acción sugerida para cada uno. */
export function Diagnosis({ findings }: { findings: Finding[] }) {
  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-1 text-sm font-medium">Diagnóstico</h2>
      {findings.length === 0 ? (
        <p className="text-sm text-neutral-500">No aparecen cuellos de botella con los datos de este período.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {findings.map((f) => (
            <li key={f.id} className={`rounded-md border p-3 text-sm ${STYLE[f.severity]}`}>
              <p className="text-xs uppercase tracking-wide text-neutral-500">{LABEL[f.severity]}</p>
              <p className="font-medium">{f.title}</p>
              <p className="text-neutral-600 dark:text-neutral-400">{f.detail}</p>
              <p className="mt-1">→ {f.action}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
