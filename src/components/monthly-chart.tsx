import Link from "next/link";
import { monthName } from "@/domain/dates";

export interface MonthlyPoint {
  month: string;
  value: number | null;
  label: string;
}

/**
 * Barras por mes de una sola serie, con el valor al pasar el mouse (o al tocar) y una
 * tabla equivalente para lectores de pantalla. El mes elegido va en el color fuerte.
 */
export function MonthlyChart({
  points,
  selected,
  metrics,
  metric,
  href,
}: {
  points: MonthlyPoint[];
  selected: string;
  metrics: { key: string; label: string }[];
  metric: string;
  href: (metric: string) => string;
}) {
  const max = Math.max(...points.map((p) => p.value ?? 0), 0);
  const title = metrics.find((m) => m.key === metric)?.label ?? "";
  return (
    <section aria-label="Evolución mensual" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title} por mes</h2>
        <div role="group" aria-label="Métrica" className="flex flex-wrap gap-1 rounded-full bg-soft p-1">
          {metrics.map((m) => (
            <Link
              key={m.key}
              href={href(m.key)}
              scroll={false}
              aria-current={m.key === metric ? "true" : undefined}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${m.key === metric ? "bg-white text-ink shadow-sm" : "text-muted"}`}
            >
              {m.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex h-44 items-end gap-3 border-b border-line" aria-hidden>
        {points.map((p) => (
          <div key={p.month} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            <span className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-semibold text-white group-hover:block">
              {p.label}
            </span>
            {p.month === selected && <span className="mb-1 text-xs font-bold tabular-nums">{p.label}</span>}
            <div
              className={`w-full max-w-14 rounded-t ${p.value === null ? "bg-soft" : p.month === selected ? "bg-accent" : "bg-[#B9D6CE]"}`}
              style={{ height: p.value === null ? 4 : `${Math.max((p.value / (max || 1)) * 100, 2)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3" aria-hidden>
        {points.map((p) => (
          <span key={p.month} className={`flex-1 text-center text-xs capitalize ${p.month === selected ? "font-bold" : "text-muted"}`}>
            {monthName(p.month).slice(0, 3)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title} por mes</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{monthName(p.month)}</th>
              <td>{p.value === null ? "Sin datos" : p.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
