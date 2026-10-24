import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { STAGES } from "@/domain/pipeline";
import { getBusinessForUser } from "@/lib/business-access";
import { formatMoney } from "@/lib/format";
import { loadPipeline, type PipelineCard } from "@/lib/pipeline-data";

function shortDate(iso: string | null, timezone: string): string {
  if (!iso) return "";
  return localDate(iso, timezone).slice(5).split("-").reverse().join("/");
}

function Card({ card, href, timezone, today }: { card: PipelineCard; href: string; timezone: string; today: string }) {
  const followUp = card.nextFollowUpAt ? localDate(card.nextFollowUpAt, timezone) : null;
  const overdue = followUp !== null && followUp <= today && !["ganado_completado", "perdido"].includes(card.stage);
  return (
    <Link
      href={href}
      className="block rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-sm hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600"
    >
      <p className="font-medium">{card.contactName ?? card.phone ?? "Sin nombre"}</p>
      {card.need && <p className="text-neutral-600 dark:text-neutral-400">{card.need}</p>}
      <p className={`mt-1 text-[11px] font-semibold ${card.funnelName ? "text-accent-dark" : "text-warn"}`}>{card.funnelName ?? "Sin atribuir"}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 text-xs text-neutral-500">
        <span className="tabular-nums">
          {card.value ? formatMoney({ [card.value.currency]: card.value.amount }) : "Sin presupuesto"}
        </span>
        <span>Últ. contacto {shortDate(card.lastInteractionAt ?? card.createdAt, timezone)}</span>
      </div>
      {followUp && !["ganado_completado", "perdido"].includes(card.stage) && (
        <p className={`mt-1 text-xs ${overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-neutral-500"}`}>
          Seguimiento {shortDate(card.nextFollowUpAt, timezone)}
          {overdue ? " · hoy o vencido" : ""}
        </p>
      )}
    </Link>
  );
}

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const onlyUnattributed = (await searchParams).embudo === "sin";
  const { user, business, supabase } = await getBusinessForUser(id, "pipeline");
  const all = await loadPipeline(supabase, id);
  const cards = onlyUnattributed ? all.filter((c) => !c.funnelName) : all;
  const today = localDate(new Date().toISOString(), business.timezone);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="w-full px-4 py-6 sm:px-6">
        <div className="mx-auto mb-4 flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Oportunidades</h1>
            <p className="text-sm text-muted">Completadas y perdidas: últimos 30 días.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={onlyUnattributed ? `/negocio/${id}/pipeline` : `/negocio/${id}/pipeline?embudo=sin`} className={onlyUnattributed ? "btn-primary" : "btn-secondary"}>
              Sin atribuir ({all.filter((c) => !c.funnelName).length})
            </Link>
            <Link href={`/negocio/${id}/pipeline/nueva`} className="btn-primary">
              Nueva oportunidad
            </Link>
          </div>
        </div>
        {/* En celular las columnas se deslizan de costado; en pantallas grandes entran todas. */}
        <div className="mx-auto flex max-w-[1600px] snap-x snap-mandatory gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const column = cards.filter((c) => c.stage === stage.id);
            return (
              <section
                key={stage.id}
                className="flex w-[80vw] max-w-72 shrink-0 snap-start flex-col gap-2 rounded-2xl bg-soft p-2 sm:w-64 xl:w-auto xl:min-w-0 xl:flex-1 dark:bg-neutral-900"
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  {stage.label}
                  <span className="text-neutral-500">{column.length}</span>
                </h2>
                {column.map((card) => (
                  <Card key={card.id} card={card} href={`/negocio/${id}/pipeline/${card.id}`} timezone={business.timezone} today={today} />
                ))}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
