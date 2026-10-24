import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { FunnelTable } from "@/components/funnel-table";
import { MonthNav, QualityBadge, parseMonth } from "@/components/ui";
import { eachDay, localDate, monthName, monthPeriod } from "@/domain/dates";
import { diagnose } from "@/domain/diagnosis";
import { computeFunnel } from "@/domain/funnel";
import { CHANNEL_LABELS } from "@/domain/quality";
import { requireMentor } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/business-access";
import { loadPipelineHealth, thresholdsOf } from "@/lib/data";
import { formatCount, formatDateTime, formatMoney, formatRatio } from "@/lib/format";
import { baselineFor, summarizeStudent } from "@/lib/mentor-data";
import { addNote, deleteNote, saveBaseline, setProgramStart } from "../../actions";

const COMPARE = [
  { key: "fact", label: "Facturación" },
  { key: "cierre", label: "Cierre" },
  { key: "consultas", label: "Consultas" },
] as const;

function change(before: number | null, now: number | null, points = false): string | null {
  if (before === null || now === null) return null;
  if (points) {
    const d = Math.round((now - before) * 100);
    return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)} pts`;
  }
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 100);
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)} %`;
}

/** Ficha 360° del alumno: antes y después, embudos, actividad, diagnóstico, calidad de datos y notas. */
export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireMentor();
  const { user, business, supabase } = await getBusinessForUser(id, "ficha");
  const today = localDate(new Date().toISOString(), business.timezone);
  const month = parseMonth(query.mes, today.slice(0, 7));
  const compare = COMPARE.find((c) => c.key === query.comparar)?.key ?? "fact";
  const [s, { data: notes }, { data: declared }, { data: sources }, health] = await Promise.all([
    summarizeStudent(supabase, business, month),
    supabase.from("mentor_notes").select("id, body, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("business_baselines").select("consultas, clientes, facturacion, notes").eq("business_id", id).maybeSingle(),
    supabase.from("data_sources").select("name, kind, last_synced_at, last_error").eq("business_id", id).eq("active", true),
    loadPipelineHealth(supabase, id),
  ]);
  const { metrics: m, report, quality: q } = s;
  const cur = business.currency;
  const local = m.facturacionPactada ? (m.facturacionPactada[cur] ?? 0) : null;
  const base = baselineFor(
    s.data,
    business.program_start,
    declared ? { consultas: declared.consultas, clientes: declared.clientes, facturacion: declared.facturacion === null ? null : Number(declared.facturacion) } : null,
    cur,
  );
  const period = monthPeriod(month, today);
  const days = new Set(eachDay(period));
  const findings = diagnose({
    metrics: m, previous: s.previous, funnel: computeFunnel(s.data, period), currency: cur,
    daysLoaded: q.daysLoaded, days: days.size, overdueFollowUps: health.overdue, staleOpen: health.stale, minSample: thresholdsOf(business).minSample,
  });

  const rows = [...report.rows.filter((r) => r.consultas > 0 || r.ventas > 0), report.sinAtribuir];
  const valueOf = (r: (typeof rows)[number]) =>
    compare === "fact" ? (r.facturacion[cur] ?? 0) : compare === "cierre" ? (r.cohort.identificadas >= 5 ? r.cohort.ratio : null) : r.consultas;
  const max = Math.max(...rows.map((r) => valueOf(r) ?? 0), 0.0001);
  const label = (r: (typeof rows)[number]) => {
    const v = valueOf(r);
    if (v === null) return compare === "cierre" && r.cohort.identificadas > 0 ? `${r.cohort.ganadas} de ${r.cohort.identificadas}` : "No aplica";
    return compare === "fact" ? formatMoney({ [cur]: v }) : compare === "cierre" ? formatRatio(v) : formatCount(v);
  };

  const baseRows = base
    ? [
        { label: "Consultas por mes", before: formatCount(base.consultas), now: formatCount(m.consultasCalificadas), change: change(base.consultas, m.consultasCalificadas) },
        { label: "Clientes únicos", before: formatCount(base.clientes), now: formatCount(m.clientes), change: change(base.clientes, m.clientes) },
        { label: "Tasa de cierre", before: formatRatio(base.cierre), now: formatRatio(m.tasaCierre?.ratio), change: change(base.cierre, m.tasaCierre?.ratio ?? null, true) },
        {
          label: "Facturación",
          before: base.facturacion === null ? "Sin datos" : formatMoney({ [cur]: base.facturacion }),
          now: formatMoney(m.facturacionPactada),
          change: change(base.facturacion, local),
        },
      ]
    : [];
  const channels = Object.entries(q.origenVentas) as [keyof typeof CHANNEL_LABELS, number][];

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/mentor" className="text-sm font-semibold text-accent">
          ← Resumen MDM
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{business.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {business.zone ? `${business.zone} · ` : ""}
              {cur} · {business.program_start ? `En MDM desde ${monthName(business.program_start.slice(0, 7))} ${business.program_start.slice(0, 4)}` : "Sin mes de ingreso"} ·
              Última carga: {formatDateTime(s.updatedAt, business.timezone)} · Cobertura de consultas {formatRatio(q.coberturaConsultas)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav month={month} current={today.slice(0, 7)} href={(mm) => `/mentor/alumno/${id}?mes=${mm}`} />
            <Link href={`/negocio/${id}`} className="btn-secondary">
              Ver como el alumno
            </Link>
            <Link href={`/negocio/${id}/embudos`} className="btn-primary">
              Configurar embudos
            </Link>
          </div>
        </div>

        <section aria-label="Antes y ahora" className="card flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">Antes de MDM y ahora</h2>
            <span className="text-[13px] text-muted">
              {base
                ? `Línea de base: ${monthName(base.month)} ${base.month.slice(0, 4)} (${base.source === "datos" ? "con datos cargados" : base.source === "declarado" ? "declarada por el mentor" : "sin datos"}) · Ahora: ${monthName(month)}`
                : "Fijá el mes de ingreso para comparar"}
            </span>
          </div>
          {base && base.source !== "sin_datos" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {baseRows.map((r) => (
                <div key={r.label} className="flex flex-col gap-1 rounded-xl bg-paper p-4">
                  <span className="label-muted">{r.label}</span>
                  <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
                    <span className="text-muted">{r.before}</span>
                    <span aria-hidden className="text-muted">→</span>
                    <span className="text-2xl font-extrabold">{r.now}</span>
                  </div>
                  {r.change && <span className={`text-[13px] font-semibold ${r.change.startsWith("▲") ? "text-good" : "text-bad"}`}>{r.change}</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">
            Mejora medida, no causa probada. {base?.source === "declarado" && "La base fue declarada (no sale de datos cargados). "}La facturación no está ajustada por
            inflación.
          </p>
          <div className="grid grid-cols-1 gap-4 border-t border-soft pt-4 md:grid-cols-2">
            <ActionForm action={setProgramStart.bind(null, id)} submitLabel="Guardar mes de ingreso" className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Mes de ingreso al programa
                <input name="month" type="month" defaultValue={business.program_start?.slice(0, 7) ?? ""} max={today.slice(0, 7)} className="input" />
              </label>
            </ActionForm>
            {base && base.source !== "datos" && (
              <ActionForm action={saveBaseline.bind(null, id, cur)} submitLabel="Guardar base declarada" className="grid grid-cols-3 gap-2">
                <p className="col-span-3 text-xs text-muted">No hay datos cargados de ese mes: cargá lo que el alumno declaró al entrar.</p>
                <label className="flex flex-col gap-1 text-sm">
                  Consultas
                  <input name="consultas" inputMode="numeric" defaultValue={declared?.consultas ?? ""} className="input" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Clientes
                  <input name="clientes" inputMode="numeric" defaultValue={declared?.clientes ?? ""} className="input" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Facturación
                  <input name="facturacion" inputMode="decimal" defaultValue={declared?.facturacion ? String(Number(declared.facturacion) / 100) : ""} className="input" />
                </label>
              </ActionForm>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          <section aria-label="Comparación de embudos" className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">Embudos de {monthName(month)}</h2>
              <div role="group" aria-label="Comparar por" className="flex gap-1 rounded-full bg-soft p-1">
                {COMPARE.map((c) => (
                  <Link
                    key={c.key}
                    href={`/mentor/alumno/${id}?${new URLSearchParams({ ...(month !== today.slice(0, 7) ? { mes: month } : {}), comparar: c.key })}`}
                    scroll={false}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${compare === c.key ? "bg-white shadow-sm" : "text-muted"}`}
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            </div>
            {rows.map((r) => {
              const v = valueOf(r);
              return (
                <div key={r.funnel?.id ?? "sin"} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 text-sm">
                  <span className="font-semibold">{r.funnel?.name ?? "Sin atribuir"}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-soft" aria-hidden>
                    <div className={`h-full rounded-full ${r.funnel ? "bg-accent" : "bg-[#A8A29E]"}`} style={{ width: `${v === null ? 0 : (v / max) * 100}%` }} />
                  </div>
                  <span className="text-right font-bold tabular-nums">{label(r)}</span>
                </div>
              );
            })}
            <p className="text-xs text-muted">
              Cierre por cohorte: ganadas ÷ consultas del mes. Con menos de 5 consultas se muestra «x de y». Las ventas directas no entran en el
              cierre.
            </p>
          </section>

          <section aria-label="Captación y datos" className="card flex flex-col gap-1 p-5 text-sm">
            <h2 className="mb-2 text-lg font-bold">Lo que hizo para conseguir clientes</h2>
            {report.rows.flatMap((r) =>
              r.actividad.slice(0, 1).map((a) => (
                <div key={r.funnel!.id} className="flex flex-wrap justify-between gap-2 border-t border-soft py-2 first:border-0">
                  <span>{r.funnel!.name}</span>
                  <span className="font-bold tabular-nums">
                    {a.steps.map((st) => `${st.unit === "dinero" ? formatMoney({ [cur]: st.value }) : formatCount(st.value)} ${st.label.toLowerCase()}`).join(" · ")}
                  </span>
                </div>
              )),
            )}
            {report.rows.every((r) => r.actividad.length === 0) && <p className="text-muted">Sin actividad de captación cargada este mes.</p>}
            <h3 className="mb-1 mt-4 font-bold">Calidad de los datos</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span>Consultas <QualityBadge quality={q.labels.consultas} /></span>
              <span>Cierre <QualityBadge quality={q.labels.cierre} /></span>
              <span>Facturación <QualityBadge quality={q.labels.facturacion} /></span>
              <span>Ganancia <QualityBadge quality={q.labels.ganancia} /></span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Cobertura: consultas {formatRatio(q.coberturaConsultas)} · con embudo {formatRatio(q.coberturaAtribucion)} · ventas con costo{" "}
              {formatRatio(q.coberturaCostos)} · total diario {q.daysLoaded} de {q.days} días
            </p>
            <p className="text-xs text-muted">
              Origen de las ventas: {channels.length ? channels.map(([c, n]) => `${CHANNEL_LABELS[c]} ${n}`).join(" · ") : "sin ventas"}
              {(sources ?? []).map((src) => ` · ${src.name}: sincronizado ${formatDateTime(src.last_synced_at, business.timezone)}${src.last_error ? " (con error)" : ""}`)}
            </p>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section aria-label="Diagnóstico" className="card flex flex-col gap-3 p-5">
            <h2 className="text-lg font-bold">Diagnóstico con evidencia</h2>
            {[...q.warnings.map((w) => ({ id: w.text, title: w.text, detail: "", action: "", tone: w.level === "alta" ? "text-bad" : "text-warn" })),
              ...findings.map((f) => ({ id: f.id, title: f.title, detail: f.detail, action: f.action, tone: f.severity === "alta" ? "text-bad" : f.severity === "media" ? "text-warn" : "text-good" }))].map((f) => (
              <div key={f.id} className="flex flex-col gap-1 border-t border-soft pt-3 first:border-0 first:pt-0 text-sm">
                <span className="flex gap-2 font-bold">
                  <span aria-hidden className={f.tone}>
                    ●
                  </span>
                  {f.title}
                </span>
                {f.detail && <span className="text-[#47433D]">{f.detail}</span>}
                {f.action && <span className="text-xs text-muted">{f.action}</span>}
              </div>
            ))}
            {q.warnings.length === 0 && findings.length === 0 && <p className="text-sm text-muted">Sin alertas: los datos del mes están completos.</p>}
          </section>

          <section aria-label="Notas del mentor" className="card flex flex-col gap-3 p-5">
            <h2 className="text-lg font-bold">Notas del mentor</h2>
            <ActionForm action={addNote.bind(null, id)} submitLabel="Guardar nota" className="flex flex-col gap-2">
              <label className="label-muted" htmlFor="nota">
                Nueva nota (solo la ves vos)
              </label>
              <textarea id="nota" name="body" rows={3} maxLength={4000} className="input" placeholder="Ej.: acordamos subir 3 reels de antes/después por semana" />
            </ActionForm>
            {(notes ?? []).map((n) => (
              <div key={n.id} className="border-t border-soft pt-3 text-sm leading-relaxed">
                <span className="flex justify-between text-xs text-muted">
                  {formatDateTime(n.created_at, business.timezone)}
                  <form action={deleteNote.bind(null, id, n.id)}>
                    <button type="submit" className="underline">
                      Borrar
                    </button>
                  </form>
                </span>
                <p className="whitespace-pre-line">{n.body}</p>
              </div>
            ))}
          </section>
        </div>

        <FunnelTable report={report} basePath={`/negocio/${id}`} />
      </main>
    </>
  );
}
