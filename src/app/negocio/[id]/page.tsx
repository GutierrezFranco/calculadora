import { AppHeader } from "@/components/app-header";
import { FunnelProfit } from "@/components/funnel-profit";
import { MonthNav, parseMonth } from "@/components/ui";
import { localDate, monthName } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { loadFunnelProfit } from "@/lib/profit-data";

/**
 * Inicio del alumno: el mes y su rentabilidad por embudo. Nada más.
 * Objetivos, proyección, oportunidades e indicadores detallados siguen disponibles en «Más».
 */
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
  const current = localDate(new Date().toISOString(), business.timezone).slice(0, 7);
  const month = parseMonth(query.mes, current);
  const profit = await loadFunnelProfit(supabase, business, month);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">{business.name}</p>
            <h1 className="text-3xl font-extrabold capitalize tracking-tight sm:text-4xl">
              {monthName(month)} {month.slice(0, 4)}
            </h1>
          </div>
          <MonthNav month={month} current={current} href={(m) => `/negocio/${id}${m === current ? "" : `?mes=${m}`}`} />
        </div>
        <FunnelProfit report={profit} currency={business.currency} basePath={`/negocio/${id}`} month={month} />
      </main>
    </>
  );
}
