import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { RANGES, parseRange } from "@/components/dashboard";
import { eachDay, lastNDays, localDate, previousPeriod } from "@/domain/dates";
import { mentorAlerts } from "@/domain/diagnosis";
import { computeMetrics } from "@/domain/metrics";
import { addTo, type MoneyTotals } from "@/domain/money";
import { requireMentor } from "@/lib/auth";
import { lastUpdate, loadBusinessData, loadPipelineHealth, thresholdsOf, type BusinessRow } from "@/lib/data";
import { daysSince, formatCount, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { resetStudentPassword, setActive } from "./actions";
import { NewStudentForm } from "./new-student-form";

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const DAYS = parseRange(params.dias);
  const onlyAlerts = params.alertas === "1";
  const user = await requireMentor();
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("*").order("name");
  const businesses = (data ?? []) as BusinessRow[];

  const allRows = await Promise.all(
    businesses.map(async (b) => {
      const [businessData, updatedAt, health] = await Promise.all([
        loadBusinessData(supabase, b),
        lastUpdate(supabase, b.id),
        loadPipelineHealth(supabase, b.id),
      ]);
      const period = lastNDays(DAYS, localDate(new Date().toISOString(), b.timezone));
      const days = new Set(eachDay(period));
      const daysLoaded = new Set(businessData.tallies.filter((t) => days.has(t.date)).map((t) => t.date)).size;
      const metrics = computeMetrics(businessData, period);
      const alerts = b.active
        ? mentorAlerts({
            metrics,
            previous: computeMetrics(businessData, previousPeriod(period)),
            daysLoaded,
            days: days.size,
            daysSinceUpdate: updatedAt ? daysSince(updatedAt) : null,
            staleOpen: health.stale,
            minSample: thresholdsOf(b).minSample,
          })
        : [];
      return { business: b, metrics, updatedAt, daysLoaded, alerts };
    }),
  );
  const rows = onlyAlerts ? allRows.filter((r) => r.alerts.length > 0) : allRows;

  // Totales del programa: cada negocio se cuenta una vez; las monedas no se mezclan.
  const totals = { consultas: 0, ventas: 0, facturacion: {} as MoneyTotals };
  for (const { metrics: m } of allRows) {
    totals.consultas += m.consultasCalificadas ?? 0;
    totals.ventas += m.ventasGanadas ?? 0;
    for (const [currency, amount] of Object.entries(m.facturacionPactada ?? {})) addTo(totals.facturacion, { amount: amount ?? 0, currency });
  }

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-semibold">Alumnos</h1>
            <p className="text-sm text-neutral-500">
              Últimos {DAYS} días · {allRows.length} negocios · {formatCount(totals.consultas)} consultas ·{" "}
              {formatCount(totals.ventas)} ventas · {formatMoney(totals.facturacion)}
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Filtros">
            {RANGES.map((r) => (
              <Link key={r} href={`/mentor?dias=${r}${onlyAlerts ? "&alertas=1" : ""}`} className={r === DAYS ? "btn-primary" : "btn-secondary"}>
                {r} días
              </Link>
            ))}
            <Link href={`/mentor?dias=${DAYS}${onlyAlerts ? "" : "&alertas=1"}`} className={onlyAlerts ? "btn-primary" : "btn-secondary"}>
              Con alertas ({allRows.filter((r) => r.alerts.length > 0).length})
            </Link>
          </nav>
        </div>

        {rows.length === 0 ? (
          <p className="mb-8 text-neutral-500">
            {onlyAlerts ? "Ningún alumno tiene alertas en este período." : "Todavía no hay alumnos. Creá el primero abajo."}
          </p>
        ) : (
          <div className="mb-10 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[960px] whitespace-nowrap text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Negocio</th>
                  <th className="px-3 py-2 font-medium">Consultas</th>
                  <th className="px-3 py-2 font-medium">Ventas</th>
                  <th className="px-3 py-2 font-medium">Facturación</th>
                  <th className="px-3 py-2 font-medium">Cobrado</th>
                  <th className="px-3 py-2 font-medium">Contribución</th>
                  <th className="px-3 py-2 font-medium">Días cargados</th>
                  <th className="px-3 py-2 font-medium">Última carga</th>
                  <th className="px-3 py-2 font-medium">Alertas</th>
                  <th className="px-3 py-2 font-medium">Acceso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ business: b, metrics: m, updatedAt, daysLoaded, alerts }) => (
                  <tr key={b.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-3 py-2">
                      <Link href={`/negocio/${b.id}`} className="font-medium underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatCount(m.consultasCalificadas)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatCount(m.ventasGanadas)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(m.facturacionPactada)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(m.cobrado)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(m.contribucion?.totals)}</td>
                    <td className={`px-3 py-2 tabular-nums ${daysLoaded < DAYS / 2 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {daysLoaded}/{DAYS}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(updatedAt, b.timezone)}</td>
                    <td className="px-3 py-2 text-xs">
                      {alerts.length === 0 ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <ul className="text-amber-700 dark:text-amber-400">
                          {alerts.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <form action={setActive.bind(null, b.id, !b.active)}>
                        <button type="submit" className="btn-secondary">
                          {b.active ? "Activo · desactivar" : "Inactivo · activar"}
                        </button>
                      </form>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-neutral-500 underline">Nueva contraseña</summary>
                        <ActionForm action={resetStudentPassword.bind(null, b.id)} submitLabel="Cambiar" className="mt-1 flex flex-col gap-1">
                          <input name="password" type="text" minLength={8} required autoComplete="off" className="input py-1 text-sm" />
                        </ActionForm>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
          <h2 className="mb-1 text-lg font-semibold">Nuevo alumno</h2>
          <p className="mb-4 text-sm text-neutral-500">
            Se crea la cuenta con una contraseña inicial que le pasás al alumno, y su negocio.
          </p>
          <NewStudentForm />
        </section>
      </main>
    </>
  );
}
