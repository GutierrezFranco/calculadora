import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { MonthNav, QualityBadge, parseMonth } from "@/components/ui";
import { addDays, localDate, monthName, monthPeriod, shiftMonth } from "@/domain/dates";
import { computeFunnelReport, stepRate, versionAt, type FunnelResult, type StepTotal } from "@/domain/funnels";
import { getBusinessForUser } from "@/lib/business-access";
import { loadBusinessData } from "@/lib/data";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";
import { deleteActivity, registerActivity, setFunnelStatus, versionFunnel } from "../actions";

const UNIT_HINT: Record<string, string> = { cantidad: "", personas: "personas distintas", horas: "horas", dinero: "monto" };

export default async function FunnelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; fid: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id, fid } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, `embudo:${fid}`);
  const today = localDate(new Date().toISOString(), business.timezone);
  const month = parseMonth((await searchParams).mes, today.slice(0, 7));
  const data = await loadBusinessData(supabase, business);
  const funnel = data.funnels?.find((f) => f.id === fid);
  if (!funnel) notFound();

  const rowFor = (mm: string): FunnelResult => computeFunnelReport(data, monthPeriod(mm, today)).rows.find((r) => r.funnel?.id === fid)!;
  const r = rowFor(month);
  const months = Array.from({ length: 4 }, (_, i) => shiftMonth(month, i - 3));
  const history = months.map((mm) => ({ month: mm, row: rowFor(mm) }));
  const current = versionAt(funnel, today)!;
  const latestVersion = funnel.versions[funnel.versions.length - 1];
  const cur = business.currency;
  const fmt = (s: StepTotal) => (s.unit === "dinero" ? formatMoney({ [cur]: s.value }) : formatCount(s.value));
  const shown = r.actividad[0];
  const period = monthPeriod(month, today);
  const records = (data.activities ?? [])
    .filter((a) => a.funnelId === fid && a.occurredOn >= period.from && a.occurredOn <= period.to)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  // Recorrido: pasos de actividad → consultas → operaciones → plata.
  const journey: { value: string; label: string; rate?: string | null; result?: boolean; quality?: "real" | "estimado" }[] = [];
  let prevValue: number | null = null;
  for (const s of shown?.steps ?? []) {
    journey.push({ value: fmt(s), label: s.label, quality: s.quality, rate: s.unit === "dinero" ? null : formatPct(stepRate(s.value, prevValue)) });
    prevValue = s.unit === "dinero" ? prevValue : s.value;
  }
  journey.push({ value: formatCount(r.consultas), label: "consultas", rate: formatPct(stepRate(r.consultas, prevValue)), result: true });
  journey.push({
    value: formatCount(r.ventas),
    label: r.ventasDirectas ? `operaciones (${r.ventas - r.ventasDirectas} de consultas + ${r.ventasDirectas} directas)` : "operaciones",
    result: true,
  });
  journey.push({ value: formatMoney(r.facturacion), label: `facturación · ${r.clientes} clientes`, result: true });

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <Link href={`/negocio/${id}/embudos?mes=${month}`} className="text-sm font-semibold text-accent">
          ← Mis embudos
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{funnel.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {funnel.templateKey ? "Plantilla" : "A medida"} · pasos versión {current.version} desde {current.validFrom.split("-").reverse().join("/")}
              {funnel.allowsDirectSales && " · admite ventas directas"}
              {funnel.status !== "activo" && ` · ${funnel.status}`}
            </p>
          </div>
          <MonthNav month={month} current={today.slice(0, 7)} href={(mm) => `/negocio/${id}/embudos/${fid}?mes=${mm}`} />
        </div>

        <section aria-label="Recorrido" className="card flex flex-col gap-4 p-5">
          <h2 className="text-lg font-bold">
            {monthName(month)[0].toUpperCase() + monthName(month).slice(1)}: de la actividad a la plata
          </h2>
          <ol className="flex flex-wrap items-stretch gap-2">
            {journey.map((j, i) => (
              <li key={i} className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-xs text-muted" aria-hidden>
                    {j.rate ? `→ ${j.rate}` : "→"}
                  </span>
                )}
                <div className={`flex min-w-32 flex-col rounded-xl px-4 py-3 ${j.result ? "bg-accent-soft" : "bg-paper"}`}>
                  <span className="text-2xl font-extrabold tabular-nums">{j.value}</span>
                  <span className="text-xs text-muted">{j.label}</span>
                  {j.quality === "estimado" && <QualityBadge quality="estimado" />}
                </div>
              </li>
            ))}
          </ol>
          {r.actividad.length > 1 && (
            <p className="text-xs text-muted">
              Este mes hay registros de {r.actividad.length} versiones de los pasos: arriba se muestra la versión {shown!.version.version}; las
              otras no se mezclan.
            </p>
          )}
          {!shown && current.steps.length > 0 && <p className="text-sm font-semibold text-warn">Sin actividad cargada este mes.</p>}
          <p className="text-xs text-muted">
            Cierre de la cohorte: {r.cohort.ganadas} de {r.cohort.identificadas} consultas del mes
            {r.cohort.identificadas >= 10 && ` (${formatRatio(r.cohort.ratio)})`}
            {r.cohort.pendientes > 0 && `, ${r.cohort.pendientes} siguen abiertas`}. Las ventas directas no entran en el cierre.
          </p>
        </section>

        <section aria-label="Mes a mes" className="card overflow-x-auto p-2 sm:p-3">
          <h2 className="px-3 pb-2 pt-2 text-lg font-bold">Mes a mes</h2>
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted">
                <th className="px-3 py-2">Mes</th>
                {current.steps.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right">
                    {s.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Consultas</th>
                <th className="px-3 py-2 text-right">Operaciones</th>
                <th className="px-3 py-2 text-right">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ month: mm, row }) => {
                const act = row.actividad.find((a) => a.version.id === current.id);
                const other = row.actividad.find((a) => a.version.id !== current.id);
                return (
                  <tr key={mm} className={`border-t border-soft ${mm === month ? "font-semibold" : ""}`}>
                    <td className="px-3 py-2 capitalize">
                      {monthName(mm)}
                      {other && !act && <span className="block text-[11px] font-normal text-muted">pasos v{other.version.version}</span>}
                    </td>
                    {current.steps.map((s) => {
                      const v = act?.steps.find((x) => x.key === s.key);
                      return (
                        <td key={s.key} className="px-3 py-2 text-right">
                          {v ? fmt(v) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right">{row.consultas}</td>
                    <td className="px-3 py-2 text-right">
                      {row.ventas}
                      {row.ventasDirectas > 0 && <span className="text-[11px] text-muted"> ({row.ventasDirectas} dir.)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(row.facturacion)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {funnel.versions.length > 1 && (
            <p className="px-3 pt-2 text-xs text-muted">
              Un «—» en un mes con otra versión de los pasos significa que ese dato no se medía igual: no se compara.
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {current.steps.length > 0 && (
            <section id="registrar" aria-label="Registrar actividad" className="card p-5">
              <h2 className="mb-1 text-lg font-bold">Registrar actividad</h2>
              <p className="mb-4 text-sm text-muted">Un registro por live, por semana de publicaciones o por período de campaña.</p>
              <ActionForm action={registerActivity.bind(null, id, fid)} submitLabel="Guardar" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Fecha
                  <input name="date" type="date" defaultValue={today} max={today} min={addDays(today, -400)} required className="input" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Nombre (opcional)
                  <input name="label" maxLength={120} placeholder="Live del lunes" className="input" />
                </label>
                {current.steps.map((s) => (
                  <label key={s.key} className="flex flex-col gap-1 text-sm">
                    {s.label} {UNIT_HINT[s.unit] && <span className="text-xs text-muted">({UNIT_HINT[s.unit]})</span>}
                    <input name={`paso:${s.key}`} inputMode="decimal" className="input" />
                    <input type="hidden" name={`unidad:${s.key}`} value={s.unit} />
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" name="estimado" /> Son valores estimados (no los saqué de la estadística)
                </label>
              </ActionForm>
            </section>
          )}

          <section aria-label="Registros del mes" className="card p-5">
            <h2 className="mb-3 text-lg font-bold">Registros de {monthName(month)}</h2>
            {records.length === 0 ? (
              <p className="text-sm text-muted">Sin registros.</p>
            ) : (
              <ul className="flex flex-col text-sm">
                {records.map((a) => {
                  const version = funnel.versions.find((v) => v.id === a.versionId);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-soft py-2 first:border-0">
                      <span>
                        <span className="font-semibold">{a.occurredOn.split("-").reverse().join("/")}</span>
                        {a.label && ` · ${a.label}`}
                        <span className="block text-xs text-muted">
                          {version?.steps
                            .filter((s) => a.values[s.key] !== undefined)
                            .map((s) => `${s.label}: ${s.unit === "dinero" ? formatMoney({ [cur]: a.values[s.key] }) : formatCount(a.values[s.key])}`)
                            .join(" · ")}
                          {version && version.id !== current.id && ` · pasos v${version.version}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <QualityBadge quality={a.quality} />
                        <form action={deleteActivity.bind(null, id, a.id)}>
                          <button type="submit" className="text-xs text-muted underline">
                            Borrar
                          </button>
                        </form>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section aria-label="Versiones de los pasos" className="card p-5">
          <h2 className="mb-3 text-lg font-bold">Versiones de los pasos</h2>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {[...funnel.versions].reverse().map((v) => (
              <li key={v.id}>
                <span className="font-semibold">v{v.version}</span> desde {v.validFrom.split("-").reverse().join("/")}:{" "}
                {v.steps.length ? v.steps.map((s) => s.label).join(" → ") : "sin pasos de actividad"}
                {v.notes && <span className="text-muted"> · {v.notes}</span>}
              </li>
            ))}
          </ul>
          {user.isMentor ? (
            <ActionForm action={versionFunnel.bind(null, id, fid)} submitLabel="Guardar versión nueva" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                Pasos nuevos (uno por línea, «Etiqueta | unidad»)
                <textarea
                  name="steps"
                  rows={4}
                  className="input"
                  defaultValue={latestVersion.steps.map((s) => `${s.label} | ${s.unit}`).join("\n")}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Valen desde
                <input name="validFrom" type="date" defaultValue={addDays(today, 1)} required className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Nota
                <input name="notes" maxLength={200} placeholder="Por qué cambia" className="input" />
              </label>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Para cambiar los pasos, pedíselo a tu mentor: los datos viejos quedan con su versión.</p>
          )}
          {funnel.status !== "archivado" && (
            <form action={setFunnelStatus.bind(null, id, fid, "archivado")} className="mt-4">
              <button type="submit" className="text-xs text-muted underline">
                Archivar este embudo (sus datos se conservan)
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}

function formatPct(ratio: number | null): string | null {
  if (ratio === null) return null;
  const p = ratio * 100;
  return `${p < 1 ? p.toFixed(2).replace(".", ",") : Math.round(p)} %`;
}
