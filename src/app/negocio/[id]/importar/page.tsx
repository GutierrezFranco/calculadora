import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { formatDateTime } from "@/lib/format";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "importar");
  const { data: history } = await supabase
    .from("data_imports")
    .select("id, kind, file_name, rows_total, rows_imported, created_at")
    .eq("business_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Importar datos</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Traé tu historial desde una planilla o desde el reporte de otro sistema. Las ventas importadas quedan marcadas
          como importadas y se pueden distinguir de las cargadas a mano.
        </p>
        <ImportWizard
          businessId={id}
          timezone={business.timezone}
          currency={business.currency}
          today={localDate(new Date().toISOString(), business.timezone)}
        />

        {history && history.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 font-medium">Importaciones anteriores</h2>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>
                    {h.file_name} · {h.kind}
                  </span>
                  <span className="text-neutral-500">
                    {h.rows_imported > 0 ? `${h.rows_imported} de ${h.rows_total} filas` : "No se completó"} ·{" "}
                    {formatDateTime(h.created_at, business.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
