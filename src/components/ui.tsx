import Link from "next/link";
import type { ReactNode } from "react";
import { monthName, shiftMonth } from "@/domain/dates";
import { QUALITY_LABELS, type Quality } from "@/domain/quality";
import { LIGHT_LABEL, type Light } from "@/domain/traffic-light";

/** Real, estimado o sin datos: siempre con texto, nunca solo color. */
export function QualityBadge({ quality, title }: { quality: Quality; title?: string }) {
  const style = {
    real: "bg-accent-soft text-accent-dark",
    estimado: "bg-warn-soft text-warn",
    desconocido: "bg-soft text-muted",
  }[quality];
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {QUALITY_LABELS[quality]}
    </span>
  );
}

const LIGHT_STYLE: Record<Light, string> = {
  verde: "bg-accent-soft text-good",
  amarillo: "bg-warn-soft text-warn",
  rojo: "bg-[#FDECEA] text-bad",
  sin_datos: "bg-soft text-muted",
  muestra_chica: "bg-soft text-muted",
};
const LIGHT_ICON: Record<Light, string> = { verde: "●", amarillo: "▲", rojo: "■", sin_datos: "○", muestra_chica: "○" };

export function LightPill({ light }: { light: Light }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${LIGHT_STYLE[light]}`}>
      <span aria-hidden>{LIGHT_ICON[light]}</span>
      {LIGHT_LABEL[light]}
    </span>
  );
}

/** Barra de avance contra un objetivo con la marca del ritmo esperado a hoy. */
export function GoalBar({ ratio, pace }: { ratio: number | null; pace: number }) {
  return (
    <div className="relative h-2 rounded-full bg-soft" aria-hidden>
      <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.min((ratio ?? 0) * 100, 100)}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 bg-muted" style={{ left: `${Math.min(pace * 100, 100)}%` }} title="Ritmo esperado a hoy" />
    </div>
  );
}

export function Kpi({
  label,
  value,
  badge,
  detail,
  footer,
}: {
  label: string;
  value: string;
  badge?: ReactNode;
  detail?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="card flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="label-muted">{label}</h2>
        {badge}
      </div>
      <p className="text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">{value}</p>
      {detail && <div className="text-xs text-muted">{detail}</div>}
      {footer}
    </article>
  );
}

export function Delta({ current, previous, suffix = "vs. mes anterior", points = false }: { current: number | null | undefined; previous: number | null | undefined; suffix?: string; points?: boolean }) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (points) {
    const diff = Math.round((current - previous) * 100);
    return <span className={`font-semibold ${diff >= 0 ? "text-good" : "text-bad"}`}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff)} pts {suffix}</span>;
  }
  if (!previous) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return <span className={`font-semibold ${change >= 0 ? "text-good" : "text-bad"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)} % {suffix}</span>;
}

/** Selector de mes: anterior, actual y siguiente (sin pasar del mes en curso). */
export function MonthNav({ month, current, href }: { month: string; current: string; href: (month: string) => string }) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <nav aria-label="Mes" className="flex items-center gap-1">
      <Link href={href(prev)} className="btn-secondary" aria-label={`Ver ${monthName(prev)}`}>
        ←
      </Link>
      <span className="min-w-36 rounded-full border border-line bg-white px-4 py-2 text-center text-sm font-semibold capitalize">
        {monthName(month)} {month.slice(0, 4)}
      </span>
      {next <= current ? (
        <Link href={href(next)} className="btn-secondary" aria-label={`Ver ${monthName(next)}`}>
          →
        </Link>
      ) : (
        <span className="btn-secondary opacity-40" aria-hidden>
          →
        </span>
      )}
    </nav>
  );
}

export function parseMonth(value: string | string[] | undefined, current: string): string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= current ? value : current;
}
