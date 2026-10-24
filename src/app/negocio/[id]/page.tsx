import { AppHeader } from "@/components/app-header";
import { Dashboard, parseRange } from "@/components/dashboard";
import { Diagnosis } from "@/components/diagnosis";
import { Funnel } from "@/components/funnel";
import { GoalsProgress } from "@/components/goals";
import { Sources } from "@/components/sources";
import { addDays, eachDay, lastNDays, localDate, previousPeriod } from "@/domain/dates";
import { diagnose } from "@/domain/diagnosis";
import { computeFunnel } from "@/domain/funnel";
import { computeMetrics } from "@/domain/metrics";
import { computeAds, computeBySource } from "@/domain/sources";
import { getBusinessForUser } from "@/lib/business-access";
import { lastUpdate, loadAdSnapshots, loadBusinessData, loadGoals, loadPipelineHealth, thresholdsOf } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

export default async function BusinessDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const days = parseRange((await searchParams).dias);
  const { user, business, supabase } = await getBusinessForUser(id, "dashboard");
  const today = localDate(new Date().toISOString(), business.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);
  const [data, updatedAt, goals, adSnapshots, health] = await Promise.all([
    loadBusinessData(supabase, business),
    lastUpdate(supabase, id),
    loadGoals(supabase, id, monthStart),
    loadAdSnapshots(supabase, id),
    loadPipelineHealth(supabase, id),
  ]);
  const period = lastNDays(days, today);
  const thresholds = thresholdsOf(business);
  const metrics = computeMetrics(data, period);
  const previous = computeMetrics(data, previousPeriod(period));
  const funnel = computeFunnel(data, period);
  const periodDays = new Set(eachDay(period));
  const daysLoaded = new Set(data.tallies.filter((t) => periodDays.has(t.date)).map((t) => t.date)).size;
  const findings = diagnose({
    metrics,
    previous,
    funnel,
    currency: business.currency,
    daysLoaded,
    days: periodDays.size,
    overdueFollowUps: health.overdue,
    staleOpen: health.stale,
    minSample: thresholds.minSample,
  });

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Dashboard
          title={business.name}
          subtitle={`Datos cargados a mano · última actualización: ${formatDateTime(updatedAt, business.timezone)}`}
          metrics={metrics}
          previous={previous}
          currency={business.currency}
          days={days}
          basePath={`/negocio/${id}`}
          before={
            <GoalsProgress
              goals={goals}
              monthToDate={computeMetrics(data, { from: monthStart, to: today })}
              monthEnd={monthEnd}
              currency={business.currency}
              settingsHref={`/negocio/${id}/configuracion`}
              thresholds={thresholds}
            />
          }
          after={
            <>
              <Diagnosis findings={findings} />
              <Funnel steps={funnel} />
              <Sources rows={computeBySource(data, period)} ads={computeAds(data, period, adSnapshots)} />
            </>
          }
        />
      </main>
    </>
  );
}
