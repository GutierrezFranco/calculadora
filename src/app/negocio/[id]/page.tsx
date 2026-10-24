import { AppHeader } from "@/components/app-header";
import { Dashboard, parseRange } from "@/components/dashboard";
import { lastNDays, localDate, previousPeriod } from "@/domain/dates";
import { computeMetrics } from "@/domain/metrics";
import { getBusinessForUser } from "@/lib/business-access";
import { lastUpdate, loadBusinessData } from "@/lib/data";
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
  const [data, updatedAt] = await Promise.all([loadBusinessData(supabase, business), lastUpdate(supabase, id)]);

  const today = localDate(new Date().toISOString(), business.timezone);
  const period = lastNDays(days, today);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Dashboard
          title={business.name}
          subtitle={`Datos cargados a mano · última actualización: ${formatDateTime(updatedAt, business.timezone)}`}
          metrics={computeMetrics(data, period)}
          previous={computeMetrics(data, previousPeriod(period))}
          currency={business.currency}
          days={days}
          basePath={`/negocio/${id}`}
        />
      </main>
    </>
  );
}
