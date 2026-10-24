import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { eachDay, lastNDays, localDate } from "@/domain/dates";
import { computeMetrics } from "@/domain/metrics";
import { requireMentor } from "@/lib/auth";
import { lastUpdate, loadBusinessData, type BusinessRow } from "@/lib/data";
import { formatCount, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { setActive } from "./actions";
import { NewStudentForm } from "./new-student-form";

const DAYS = 30;

export default async function MentorPage() {
  const user = await requireMentor();
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("*").order("name");
  const businesses = (data ?? []) as BusinessRow[];

  const rows = await Promise.all(
    businesses.map(async (b) => {
      const [businessData, updatedAt] = await Promise.all([loadBusinessData(supabase, b), lastUpdate(supabase, b.id)]);
      const period = lastNDays(DAYS, localDate(new Date().toISOString(), b.timezone));
      const days = new Set(eachDay(period));
      const daysLoaded = new Set(businessData.tallies.filter((t) => days.has(t.date)).map((t) => t.date)).size;
      return { business: b, metrics: computeMetrics(businessData, period), updatedAt, daysLoaded };
    }),
  );

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Alumnos</h1>
        <p className="mb-6 text-sm text-neutral-500">Últimos {DAYS} días de cada negocio.</p>

        {rows.length === 0 ? (
          <p className="mb-8 text-neutral-500">Todavía no hay alumnos. Creá el primero abajo.</p>
        ) : (
          <div className="mb-10 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-[720px] whitespace-nowrap text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Negocio</th>
                  <th className="px-3 py-2 font-medium">Consultas</th>
                  <th className="px-3 py-2 font-medium">Ventas</th>
                  <th className="px-3 py-2 font-medium">Facturación</th>
                  <th className="px-3 py-2 font-medium">Cobrado</th>
                  <th className="px-3 py-2 font-medium">Días cargados</th>
                  <th className="px-3 py-2 font-medium">Última carga</th>
                  <th className="px-3 py-2 font-medium">Acceso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ business: b, metrics: m, updatedAt, daysLoaded }) => (
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
                    <td className={`px-3 py-2 tabular-nums ${daysLoaded < DAYS / 2 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {daysLoaded}/{DAYS}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(updatedAt, b.timezone)}</td>
                    <td className="px-3 py-2">
                      <form action={setActive.bind(null, b.id, !b.active)}>
                        <button type="submit" className="btn-secondary">
                          {b.active ? "Activo · desactivar" : "Inactivo · activar"}
                        </button>
                      </form>
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
