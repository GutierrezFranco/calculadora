import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { FunnelTable } from "@/components/funnel-table";
import { FunnelProfit } from "@/components/funnel-profit";
import { loadFunnelProfit } from "@/lib/profit-data";
import { MonthlyChart } from "@/components/monthly-chart";
import { Delta, GoalBar, Kpi, LightPill, MonthNav, QualityBadge, parseMonth } from "@/components/ui";
import { MIN_COVERAGE } from "@/domain/cohort";
import { daysInPeriod, eachDay, localDate, monthEnd, monthName, monthPeriod, shiftMonth } from "@/domain/dates";
import { diagnose } from "@/domain/diagnosis";
import { computeFunnel } from "@/domain/funnel";
import { computeFunnelReport } from "@/domain/funnels";
import { computeMetrics, type PeriodMetrics } from "@/domain/metrics";
import { assessQuality, CHANNEL_LABELS } from "@/domain/quality";
import { computeAds } from "@/domain/sources";
import { trafficLight } from "@/domain/traffic-light";
import { getBusinessForUser } from "@/lib/business-access";
import { countPendingReview, lastUpdate, loadAdSnapshots, loadBusinessData, loadGoals, loadPipelineHealth, thresholdsOf } from "@/lib/data";
import { daysSince, formatCount, formatDateTime, formatMoney, formatRatio } from "@/lib/format";

const SERIES = [
  { key: "facturacion", label: "Facturación" },
  { key: "consultas", label: "Consultas" },
  { key: "clientes", label: "Clientes" },
  { key: "cierre", label: "Cierre" },
] as const;

export default async function BusinessHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { user, business, supabase } = await getBusinessForUser(id, "dashboard");
  const today = localDate(new Date().toISOString(), business.timezone);
  const currentMonth = today.slice(0, 7);
  const month = parseMonth(query.mes, currentMonth);
  const serie = SERIES.find((s) => s.key === query.serie)?.key ?? "facturacion";
  const [data, updatedAt, goals, adSnapshots, health, pendingReview, sources, profit] = await Promise.all([
    loadBusinessData(supabase, business),
    lastUpdate(supabase, id),
    loadGoals(supabase, id, `${month}-01`),
    loadAdSnapshots(supabase, id),
    loadPipelineHealth(supabase, id),
    countPendingReview(supabase, id),
    supabase.from("data_sources").select("name, last_synced_at").eq("business_id", id).eq("active", true),
    loadFunnelProfit(supabase, business, month),
  ]);

  const period = monthPeriod(month, today);
  const prevPeriod = monthPeriod(shiftMonth(month, -1), today);
  const m = computeMetrics(data, period);
  const prev = computeMetrics(data, prevPeriod);
  const report = computeFunnelReport(data, period);
  const thresholds = thresholdsOf(business);
  const cur = business.currency;
  const local = (t: PeriodMetrics["facturacionPactada"]) => (t ? (t[cur] ?? 0) : null);
  const pace = daysInPeriod(period) / daysInPeriod({ from: period.from, to: monthEnd(month) });
  const periodDays = new Set(eachDay(period));
  const daysLoaded = new Set(data.tallies.filter((t) => periodDays.has(t.date)).map((t) => t.date)).size;
  const quality = assessQuality({
    data, period, metrics: m, report, daysLoaded, days: periodDays.size,
    daysSinceUpdate: updatedAt ? daysSince(updatedAt) : null, pendingReview, minSample: thresholds.minSample,
  });
  const findings = diagnose({
    metrics: m, previous: prev, funnel: computeFunnel(data, period), currency: cur, daysLoaded, days: periodDays.size,
    overdueFollowUps: health.overdue, staleOpen: health.stale, minSample: thresholds.minSample,
  });
  const ads = computeAds(data, period, adSnapshots);
  const close = m.tasaCierre;

  const goalLight = (actual: number | null, target: number | null) =>
    trafficLight({ actual, target, expectedFraction: pace, sample: m.consultasCalificadas, thresholds });
  const goalFooter = (actual: number | null, target: number | null, fmt: (v: number) => string) =>
    target ? (
      <div className="mt-1 flex flex-col gap-1.5">
        <GoalBar ratio={actual === null ? null : actual / target} pace={pace} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            {actual === null ? "Sin datos" : `${Math.round((actual / target) * 100)} %`} del objetivo de {fmt(target)}
          </span>
          <LightPill light={goalLight(actual, target)} />
        </div>
      </div>
    ) : (
      <Link href={`/negocio/${id}/configuracion`} className="text-xs font-semibold text-accent">
        Cargar objetivo
      </Link>
    );

  // Serie de los últimos 6 meses hasta el elegido.
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const points = months.map((mm) => {
    const pm = computeMetrics(data, monthPeriod(mm, today));
    const value =
      serie === "facturacion" ? local(pm.facturacionPactada)
      : serie === "consultas" ? pm.consultasCalificadas
      : serie === "clientes" ? pm.clientes
      : pm.tasaCierre?.ratio ?? null;
    const label =
      value === null ? "Sin datos"
      : serie === "facturacion" ? formatMoney({ [cur]: value })
      : serie === "cierre" ? formatRatio(value)
      : formatCount(value);
    return { month: mm, value: serie === "cierre" && value !== null ? Math.round(value * 1000) : value, label };
  });
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(month !== currentMonth ? { mes: month } : {}), ...(serie !== "facturacion" ? { serie } : {}), ...over });
    return `/negocio/${id}${p.size ? `?${p}` : ""}`;
  };

  const channels = Object.keys(quality.origenVentas) as (keyof typeof CHANNEL_LABELS)[];
  const top = findings[0];
  const healthItems = [
    health.overdue > 0 && `${health.overdue} seguimientos vencidos`,
    health.stale > 0 && `${health.stale} oportunidades sin movimiento hace más de 14 días`,
    pendingReview > 0 && `${pendingReview} coincidencias de importación para revisar`,
  ].filter(Boolean) as string[];

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">
              {business.name} · comparado con {monthName(shiftMonth(month, -1))}
            </p>
            <h1 className="text-3xl font-extrabold capitalize tracking-tight sm:text-4xl">
              {monthName(month)} {month.slice(0, 4)}
            </h1>
            <p className="mt-1 text-xs text-muted">
              Última actualización: {formatDateTime(updatedAt, business.timezone)}
              {channels.length > 0 && ` · ventas de ${channels.map((c) => CHANNEL_LABELS[c].toLowerCase()).join(", ")}`}
              {(sources.data ?? []).map((s) => ` · ${s.name}: sincronizado ${formatDateTime(s.last_synced_at, business.timezone)}`)}
            </p>
          </div>
          <MonthNav month={month} current={currentMonth} href={(mm) => qs({ mes: mm })} />
        </div>

        <FunnelProfit report={profit} currency={cur} basePath={`/negocio/${id}`} month={month} />

        <section aria-label="Indicadores principales" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Consultas"
            value={formatCount(m.consultasCalificadas)}
            badge={<QualityBadge quality={quality.labels.consultas} title={`Total del día cargado ${daysLoaded} de ${periodDays.size} días`} />}
            detail={<Delta current={m.consultasCalificadas} previous={prev.consultasCalificadas} />}
            footer={goalFooter(m.consultasCalificadas, goals.consultas, formatCount)}
          />
          <Kpi
            label="Clientes"
            value={formatCount(m.clientes)}
            detail={
              m.ventas ? (
                <>
                  {m.ventas.total} operaciones ganadas
                  {m.ventas.directas > 0 && ` · ${m.ventas.directas} ventas directas`}
                  {prev.clientes ? (
                    <>
                      {" · "}
                      <Delta current={m.clientes} previous={prev.clientes} />
                    </>
                  ) : null}
                </>
              ) : null
            }
            footer={goalFooter(m.ventasGanadas, goals.ventas, (v) => `${formatCount(v)} ventas`)}
          />
          <Kpi
            label="Tasa de cierre"
            value={formatRatio(close?.ratio)}
            badge={<QualityBadge quality={quality.labels.cierre} />}
            detail={
              close && close.identificadas > 0 ? (
                <div className="flex flex-col gap-0.5">
                  <span>
                    {close.ganadas} ganadas de {close.identificadas} consultas del mes
                    {close.pendientes > 0 && ` · ${close.pendientes} siguen abiertas, puede subir`}
                  </span>
                  <span className={close.cobertura !== null && close.cobertura < MIN_COVERAGE ? "font-semibold text-warn" : ""}>
                    Cobertura {formatRatio(close.cobertura)}: consultas cargadas una por una
                  </span>
                  {close.cancelaciones > 0 && <span>{close.cancelaciones} cancelaciones técnicas (no cuentan)</span>}
                  <Delta current={close.ratio} previous={prev.tasaCierre?.ratio} points />
                </div>
              ) : (
                "Cargá cada consulta como oportunidad para medir el cierre"
              )
            }
          />
          <Kpi
            label="Facturación"
            value={formatMoney(m.facturacionPactada)}
            badge={<QualityBadge quality={quality.labels.facturacion} />}
            detail={<Delta current={local(m.facturacionPactada)} previous={local(prev.facturacionPactada)} />}
            footer={goalFooter(local(m.facturacionPactada), goals.facturacion, (v) => formatMoney({ [cur]: v }))}
          />
        </section>

        <section aria-label="Más indicadores" className="card grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <p className="label-muted flex items-center gap-2">
              Margen sin publicidad <QualityBadge quality={quality.labels.ganancia} />
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatMoney(m.contribucion?.totals)}</p>
            <p className="text-xs text-muted">
              {m.contribucion?.ventasSinCosto ? `${m.contribucion.ventasSinCosto} ventas sin costo` : "Venta − costo directo"}
            </p>
          </div>
          <div>
            <p className="label-muted">Cobrado</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatMoney(m.cobrado)}</p>
            <p className="text-xs text-muted">Saldo por cobrar {formatMoney(m.saldoPendiente)}</p>
          </div>
          <div>
            <p className="label-muted">Ticket promedio</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatMoney(m.ticketPactado)}</p>
            <p className="text-xs text-muted">Cobrado: {formatMoney(m.ticketCobrado)}</p>
          </div>
          <div>
            <p className="label-muted">Inversión en anuncios</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{ads ? formatMoney(ads.spend) : "Sin datos"}</p>
            <p className="text-xs text-muted">
              Costo por cliente {ads?.costPerClient ? formatMoney(ads.costPerClient) : "Sin datos"}
            </p>
          </div>
          <div>
            <p className="label-muted">Ventas del mes</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatCount(m.ventas?.total)}</p>
            <p className="text-xs text-muted">
              {m.ventas
                ? `${m.ventas.deLaCohorte} del mes · ${m.ventas.deCohortesAnteriores} de meses anteriores · ${m.ventas.directas} directas`
                : "Sin datos"}
            </p>
          </div>
          <div>
            <p className="label-muted">Señas retenidas</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatMoney(m.senasRetenidas)}</p>
            <p className="text-xs text-muted">De consultas perdidas</p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <MonthlyChart points={points} selected={month} metrics={[...SERIES]} metric={serie} href={(k) => qs({ serie: k })} />
          <section aria-label="Para hacer hoy" className="flex flex-col gap-3">
            {top && top.id !== "sin_datos" ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-accent p-5 text-white">
                <span className="text-[11px] font-semibold uppercase tracking-wide opacity-90">Para hacer hoy</span>
                <p className="text-lg font-bold leading-snug">{top.title}</p>
                <p className="text-sm opacity-90">{top.detail}</p>
                <p className="text-sm font-semibold">{top.action}</p>
              </div>
            ) : (
              <div className="card flex flex-col gap-2 p-5">
                <span className="label-muted">Para hacer hoy</span>
                <p className="font-semibold">{top ? top.action : "Todo en orden: seguí cargando tus consultas y ventas."}</p>
                <Link href={`/negocio/${id}/cargar`} className="btn-accent self-start">
                  Registrar reparación o venta
                </Link>
              </div>
            )}
            {(healthItems.length > 0 || findings.length > 1) && (
              <div className="card flex flex-col gap-1 p-5 text-sm">
                <h2 className="label-muted mb-1">Diagnóstico</h2>
                {healthItems.map((h) => (
                  <p key={h} className="border-t border-soft py-2 first:border-0">
                    {h}
                  </p>
                ))}
                {findings.slice(1).map((f) => (
                  <p key={f.id} className="border-t border-soft py-2 first:border-0">
                    <span className="font-semibold">{f.title}.</span> <span className="text-muted">{f.action}</span>
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>

        <FunnelTable report={report} basePath={`/negocio/${id}`} />

        {(quality.warnings.length > 0 || m.avisos.length > 0) && (
          <section aria-label="Calidad de los datos" className="card p-5 text-sm">
            <h2 className="label-muted mb-2">Calidad de los datos</h2>
            <ul className="flex flex-col gap-1 text-muted">
              {quality.warnings.map((w) => (
                <li key={w.text}>
                  <span aria-hidden className={w.level === "alta" ? "text-bad" : "text-warn"}>
                    ●{" "}
                  </span>
                  {w.text}
                </li>
              ))}
              {m.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
