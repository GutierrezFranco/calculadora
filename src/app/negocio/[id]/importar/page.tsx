import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import Link from "next/link";
import { CHANNEL_LABELS } from "@/domain/quality";
import { countPendingReview } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { deleteSource, syncSource, undoImport } from "./actions";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "importar");
  const [{ data: history }, { data: funnels }, { data: sources }, pending] = await Promise.all([
    supabase
      .from("data_imports")
      .select("id, kind, file_name, rows_total, rows_imported, rows_duplicate, rows_review, created_at, undone_at, channel, status")
      .eq("business_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("funnels").select("id, name").eq("business_id", id).eq("status", "activo").order("created_at"),
    supabase.from("data_sources").select("id, name, data_kind, last_synced_at, last_error").eq("business_id", id).eq("active", true).order("created_at"),
    countPendingReview(supabase, id),
  ]);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-3xl font-extrabold tracking-tight">Importar datos</h1>
        <p className="mb-6 text-sm text-muted">
          Seguí usando tu sistema de siempre: traé desde ahí tus ventas y consultas (Excel, CSV o Google Sheets). Lo que ya estaba
          no se duplica, lo dudoso te lo preguntamos y cada dato queda marcado con su origen.
        </p>
        {pending > 0 && (
          <Link href={`/negocio/${id}/importar/revisar`} className="card mb-6 flex items-center justify-between gap-3 border-warn bg-warn-soft p-4 text-sm font-semibold text-warn">
            {pending} coincidencias para revisar
            <span>Revisar →</span>
          </Link>
        )}
        {sources && sources.length > 0 && (
          <section className="card mb-6 p-4 sm:p-6">
            <h2 className="mb-3 font-bold">Planillas conectadas</h2>
            <ul className="flex flex-col text-sm">
              {sources.map((src) => (
                <li key={src.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-soft py-2 first:border-0">
                  <span>
                    <span className="font-semibold">{src.name}</span> · {src.data_kind}
                    <span className="block text-xs text-muted">
                      Última sincronización: {formatDateTime(src.last_synced_at, business.timezone)}
                      {src.last_error && <span className="text-bad"> · {src.last_error}</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <form action={syncSource.bind(null, id, src.id)}>
                      <button type="submit" className="btn-secondary">
                        Sincronizar ahora
                      </button>
                    </form>
                    <form action={deleteSource.bind(null, id, src.id)}>
                      <button type="submit" className="text-xs text-muted underline">
                        Desconectar
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <ImportWizard
          funnels={(funnels ?? []) as { id: string; name: string }[]}
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
                    {h.file_name} · {h.kind} · {CHANNEL_LABELS[h.channel as keyof typeof CHANNEL_LABELS]}
                  </span>
                  <span className="text-neutral-500">
                    {h.undone_at
                      ? `Deshecha el ${formatDateTime(h.undone_at, business.timezone)}`
                      : h.status === "preparada"
                        ? "Sin aplicar"
                        : `${h.rows_imported} de ${h.rows_total} filas${h.rows_duplicate ? ` · ${h.rows_duplicate} duplicadas omitidas` : ""}${h.rows_review ? ` · ${h.rows_review} por revisar` : ""}`}{" "}
                    · {formatDateTime(h.created_at, business.timezone)}
                  </span>
                  {!h.undone_at && h.status !== "preparada" && (
                    <details className="w-full text-right">
                      <summary className="cursor-pointer text-xs text-red-700 underline dark:text-red-400">Deshacer</summary>
                      <form action={undoImport.bind(null, id, h.id)} className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <span className="text-xs text-neutral-500">
                          Se quitan los {h.rows_imported} registros que trajo este archivo (los prospectos ya convertidos se conservan).
                        </span>
                        <button type="submit" className="btn-secondary">
                          Confirmar: deshacer importación
                        </button>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
