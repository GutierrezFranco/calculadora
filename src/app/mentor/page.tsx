import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { MonthNav, QualityBadge, parseMonth } from "@/components/ui";
import { localDate, monthName, shiftMonth } from "@/domain/dates";
import { addTo, type MoneyTotals } from "@/domain/money";
import { CHANNEL_LABELS } from "@/domain/quality";
import { requireMentor } from "@/lib/auth";
import { loadTemplates, type BusinessRow } from "@/lib/data";
import { daysSince, formatCount, formatDateTime, formatMoney, formatRatio } from "@/lib/format";
import { baselineFor, summarizeStudent, type StudentSummary } from "@/lib/mentor-data";
import { createClient } from "@/lib/supabase/server";
import { resetStudentPassword, setActive } from "./actions";
import { NewStudentForm } from "./new-student-form";

function Spark({ values }: { values: (number | null)[] }) {
  const max = Math.max(...values.map((v) => v ?? 0), 1);
  return (
    <div className="flex h-7 w-20 items-end gap-0.5" aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${v === null ? "bg-line" : i === values.length - 1 ? "bg-accent" : "bg-[#B9D6CE]"}`}
          style={{ height: v === null ? 3 : Math.max(Math.round((v / max) * 28), 3) }}
        />
      ))}
    </div>
  );
}

function needsAttention(s: StudentSummary): boolean {
  return s.business.active && s.quality.warnings.length > 0;
}

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const onlyAlerts = params.alertas === "1";
  const funnelFilter = typeof params.embudo === "string" ? params.embudo : "";
  const user = await requireMentor();
  const supabase = await createClient();
  const currentMonth = localDate(new Date().toISOString(), "America/Argentina/Buenos_Aires").slice(0, 7);
  const month = parseMonth(params.mes, currentMonth);
  const [{ data }, templates, { data: baselines }] = await Promise.all([
    supabase.from("businesses").select("*").order("name"),
    loadTemplates(supabase),
    supabase.from("business_baselines").select("business_id, consultas, clientes, facturacion"),
  ]);
  const businesses = (data ?? []) as BusinessRow[];
  const all = await Promise.all(businesses.map((b) => summarizeStudent(supabase, b, month)));

  const withFunnel = funnelFilter ? all.filter((s) => s.data.funnels?.some((f) => f.templateKey === funnelFilter && f.status === "activo")) : all;
  const rows = onlyAlerts ? withFunnel.filter(needsAttention) : withFunnel;
  const attention = withFunnel.filter(needsAttention).length;

  // Totales del programa: sumas de totales (no promedios de porcentajes) y cada moneda aparte.
  const totals = { consultas: 0, clientes: 0, ganadas: 0, identificadas: 0, recibidas: 0, facturacion: {} as MoneyTotals, conDatos: 0 };
  for (const s of withFunnel.filter((x) => x.business.active)) {
    const m = s.metrics;
    if (m.consultasCalificadas !== null) totals.conDatos++;
    totals.consultas += m.consultasCalificadas ?? 0;
    totals.clientes += m.clientes ?? 0;
    totals.ganadas += m.tasaCierre?.ganadas ?? 0;
    totals.identificadas += m.tasaCierre?.identificadas ?? 0;
    totals.recibidas += m.tasaCierre?.recibidas ?? 0;
    for (const [currency, amount] of Object.entries(m.facturacionPactada ?? {})) addTo(totals.facturacion, { amount: amount ?? 0, currency });
  }
  const prevConsultas = withFunnel.reduce((n, s) => n + (s.metrics.consultasCalificadas !== null ? (s.previous.consultasCalificadas ?? 0) : 0), 0);

  // Mejoras comprobables: 3 meses o más en el programa, base y cobertura suficientes.
  const improvements = all
    .map((s) => {
      const declared = baselines?.find((x) => x.business_id === s.business.id) ?? null;
      const base = baselineFor(s.data, s.business.program_start, declared, s.business.currency);
      return { s, base };
    })
    .filter(({ s, base }) => base && base.source !== "sin_datos" && base.month <= shiftMonth(month, -2) && (s.quality.coberturaConsultas ?? 0) >= 0.7)
    .slice(0, 5);

  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { mes: month !== currentMonth ? month : null, alertas: onlyAlerts ? "1" : null, embudo: funnelFilter || null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/mentor${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Programa MDM · <span className="capitalize">{monthName(month)}</span> {month.slice(0, 4)}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {businesses.filter((b) => b.active).length} alumnos activos · {totals.conDatos} con datos este mes
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav month={month} current={currentMonth} href={(mm) => qs({ mes: mm === currentMonth ? null : mm })} />
            <form action="/mentor" className="flex items-center gap-2">
              {month !== currentMonth && <input type="hidden" name="mes" value={month} />}
              {onlyAlerts && <input type="hidden" name="alertas" value="1" />}
              <select name="embudo" defaultValue={funnelFilter} className="input py-1.5 text-sm" aria-label="Embudo">
                <option value="">Todos los embudos</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    Con {t.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary">
                Filtrar
              </button>
            </form>
            <Link href={qs({ alertas: onlyAlerts ? null : "1" })} className={onlyAlerts ? "btn-primary" : "btn-secondary"}>
              Necesitan atención ({attention})
            </Link>
          </div>
        </div>

        <section aria-label="Totales del programa" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="card flex flex-col gap-1 p-5">
            <span className="label-muted">Consultas</span>
            <span className="text-3xl font-extrabold tabular-nums">{formatCount(totals.consultas)}</span>
            {prevConsultas > 0 && (
              <span className={`text-xs font-semibold ${totals.consultas >= prevConsultas ? "text-good" : "text-bad"}`}>
                {totals.consultas >= prevConsultas ? "▲" : "▼"} {Math.abs(Math.round(((totals.consultas - prevConsultas) / prevConsultas) * 100))} % vs. mes
                anterior, mismos alumnos
              </span>
            )}
          </div>
          <div className="card flex flex-col gap-1 p-5">
            <span className="label-muted">Clientes</span>
            <span className="text-3xl font-extrabold tabular-nums">{formatCount(totals.clientes)}</span>
            <span className="text-xs text-muted">Suma de los clientes únicos de cada alumno</span>
          </div>
          <div className="card flex flex-col gap-1 p-5">
            <span className="label-muted">Cierre del programa</span>
            <span className="text-3xl font-extrabold tabular-nums">{totals.identificadas ? formatRatio(totals.ganadas / totals.identificadas) : "Sin datos"}</span>
            <span className="text-xs text-muted">
              {totals.ganadas} ganadas ÷ {totals.identificadas} consultas identificadas (no es un promedio de alumnos) · cobertura{" "}
              {totals.recibidas ? formatRatio(Math.min(totals.identificadas / totals.recibidas, 1)) : "—"}
            </span>
          </div>
          <div className="card flex flex-col gap-1 p-5">
            <span className="label-muted">Facturación</span>
            <span className="text-2xl font-extrabold leading-tight tabular-nums">
              {Object.keys(totals.facturacion).length === 0
                ? "Sin datos"
                : Object.entries(totals.facturacion).map(([c, v]) => (
                    <span key={c} className="block">
                      {formatMoney({ [c]: v })}
                    </span>
                  ))}
            </span>
            <span className="text-xs text-muted">Cada moneda por separado</span>
          </div>
        </section>

        {rows.length === 0 ? (
          <p className="card p-5 text-muted">
            {onlyAlerts ? "Ningún alumno necesita atención en este período." : "Todavía no hay alumnos. Creá el primero abajo."}
          </p>
        ) : (
          <section aria-label="Alumnos" className="card overflow-x-auto p-2">
            <table className="w-full min-w-[1180px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th className="px-3 py-2">Alumno</th>
                  <th className="whitespace-nowrap px-3 py-2">En MDM desde</th>
                  <th className="px-3 py-2 text-right">Consultas</th>
                  <th className="px-3 py-2 text-right">Clientes</th>
                  <th className="px-3 py-2 text-right">Cierre</th>
                  <th className="px-3 py-2 text-right">Facturación</th>
                  <th className="px-3 py-2 text-right">Ganancia</th>
                  <th className="px-3 py-2">6 meses</th>
                  <th className="px-3 py-2">Datos</th>
                  <th className="px-3 py-2">Atención</th>
                  <th className="px-3 py-2">Acceso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const { business: b, metrics: m, quality: q, previous: p } = s;
                  const delta =
                    m.consultasCalificadas !== null && p.consultasCalificadas
                      ? Math.round(((m.consultasCalificadas - p.consultasCalificadas) / p.consultasCalificadas) * 100)
                      : null;
                  const channels = Object.keys(q.origenVentas) as (keyof typeof CHANNEL_LABELS)[];
                  return (
                    <tr key={b.id} className="border-t border-soft align-top">
                      <td className="min-w-52 px-3 py-3">
                        <Link href={`/mentor/alumno/${b.id}`} className="font-bold text-ink hover:underline">
                          {b.name}
                        </Link>
                        <span className="block text-xs text-muted">
                          {b.zone ? `${b.zone} · ` : ""}
                          {b.currency} ·{" "}
                          <Link href={`/negocio/${b.id}`} className="underline">
                            ver como el alumno
                          </Link>
                        </span>
                      </td>
                      <td className="px-3 py-3 capitalize text-[#47433D]">
                        {b.program_start ? `${monthName(b.program_start.slice(0, 7)).slice(0, 3)} ${b.program_start.slice(0, 4)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-semibold">{formatCount(m.consultasCalificadas)}</span>
                        {m.consultasCalificadas === null && <span className="block text-[11px] text-muted">no es cero</span>}
                        {delta !== null && (
                          <span className={`block text-[11px] font-semibold ${delta >= 0 ? "text-good" : "text-bad"}`}>
                            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} %
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatCount(m.clientes)}
                        {m.ventas?.directas ? <span className="block text-[11px] text-muted">{m.ventas.directas} directas</span> : null}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatRatio(m.tasaCierre?.ratio)}
                        {m.tasaCierre?.cobertura !== null && m.tasaCierre?.cobertura !== undefined && (
                          <span className={`block text-[11px] ${m.tasaCierre.cobertura < 0.7 ? "font-semibold text-warn" : "text-muted"}`}>
                            cobertura {formatRatio(m.tasaCierre.cobertura)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{formatMoney(m.facturacionPactada)}</td>
                      <td className="px-3 py-3 text-right">
                        {formatMoney(m.contribucion?.totals)}
                        {q.labels.ganancia === "estimado" && (
                          <span className="block text-[11px] text-warn">incompleta ({formatRatio(q.coberturaCostos)} con costo)</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Spark values={s.spark} />
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <span className={s.updatedAt && daysSince(s.updatedAt) >= 7 ? "font-bold text-bad" : ""}>
                          {formatDateTime(s.updatedAt, b.timezone)}
                        </span>
                        <span className="block text-muted">{channels.length ? channels.map((c) => CHANNEL_LABELS[c]).join(", ") : "Sin ventas"}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <QualityBadge quality={q.labels.consultas} title="Consultas" />
                          {s.actions.length > 0 && <span className="text-muted">{s.actions.join(" · ")}</span>}
                        </span>
                      </td>
                      <td className="min-w-48 px-3 py-3 text-xs">
                        {!b.active ? (
                          <span className="text-muted">Acceso desactivado</span>
                        ) : q.warnings.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {q.warnings.map((w) => (
                              <li key={w.text} className={w.level === "alta" ? "font-semibold text-bad" : "font-semibold text-warn"}>
                                {w.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <form action={setActive.bind(null, b.id, !b.active)}>
                          <button type="submit" className="btn-secondary whitespace-nowrap">
                            {b.active ? "Activo · desactivar" : "Inactivo · activar"}
                          </button>
                        </form>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted underline">Nueva contraseña</summary>
                          <ActionForm action={resetStudentPassword.bind(null, b.id)} submitLabel="Cambiar" className="mt-1 flex flex-col gap-1">
                            <input name="password" type="text" minLength={8} required autoComplete="off" className="input py-1 text-sm" />
                          </ActionForm>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section aria-label="Mejoras comprobables" className="card flex flex-col gap-2 p-5">
            <h2 className="text-lg font-bold">Mejoras comprobables desde que entraron</h2>
            <p className="text-[13px] text-muted">
              Alumnos con 3 meses o más en el programa, línea de base y cobertura de 70 % o más. Útil para casos de éxito, con su
              consentimiento.
            </p>
            {improvements.length === 0 ? (
              <p className="text-sm text-muted">Todavía no hay alumnos con datos suficientes para comparar.</p>
            ) : (
              improvements.map(({ s, base }) => (
                <div key={s.business.id} className="flex flex-wrap justify-between gap-2 border-t border-soft py-2 text-sm">
                  <Link href={`/mentor/alumno/${s.business.id}`} className="font-semibold text-ink hover:underline">
                    {s.business.name}
                  </Link>
                  <span>
                    Consultas {formatCount(base!.consultas)} → {formatCount(s.metrics.consultasCalificadas)}
                    {base!.facturacion && s.metrics.facturacionPactada
                      ? ` · Facturación ${(s.metrics.facturacionPactada[s.business.currency] ?? 0) >= base!.facturacion ? "▲" : "▼"} ${Math.abs(Math.round((((s.metrics.facturacionPactada[s.business.currency] ?? 0) - base!.facturacion) / base!.facturacion) * 100))} %`
                      : ""}
                    {base!.source === "declarado" && <span className="text-muted"> (base declarada)</span>}
                  </span>
                </div>
              ))
            )}
            <p className="text-xs text-muted">Mejora medida, no causa probada: puede haber otros factores (temporada, precios).</p>
          </section>

          <section aria-label="Nuevo alumno" className="card p-5">
            <h2 className="mb-1 text-lg font-bold">Nuevo alumno</h2>
            <p className="mb-4 text-sm text-muted">Se crea la cuenta con una contraseña inicial que le pasás al alumno, y su negocio.</p>
            <NewStudentForm />
          </section>
        </div>
      </main>
    </>
  );
}
