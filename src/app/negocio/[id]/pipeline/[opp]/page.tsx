import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { FunnelSelect } from "@/components/funnel-select";
import { PAYMENT_KIND_LABELS } from "@/components/options";
import { localDate } from "@/domain/dates";
import { convert } from "@/domain/money";
import { STAGES, isWonStage } from "@/domain/pipeline";
import { getBusinessForUser } from "@/lib/business-access";
import { formatDateTime, formatMoney } from "@/lib/format";
import { funnelOptions } from "@/lib/funnel-choice";
import { loadOpportunity } from "@/lib/pipeline-data";
import {
  addPayment,
  addQuote,
  addTouchpoint,
  assignFunnel,
  cancelJob,
  loseOpportunity,
  moveOpportunity,
  reopenOpportunity,
  reverseSale,
  updateCost,
  updateFollowUp,
  winOpportunity,
} from "../actions";

const CONFIDENCE_LABELS: Record<string, string> = { confirmada: "confirmado", declarada: "declarado", inferida: "inferido" };
const LOST_LABELS: Record<string, string> = {
  precio: "precio",
  sin_respuesta: "dejó de responder",
  eligio_otro: "eligió a otro",
  no_reparable: "no tenía arreglo",
  otro: "otro",
};

const OPEN_STAGES = STAGES.filter((s) => ["nueva_consulta", "presupuestado", "en_seguimiento", "senado"].includes(s.id));

function Panel({ title, children, tone }: { title: string; children: ReactNode; tone?: "danger" }) {
  return (
    <section
      className={`rounded-lg border p-4 ${tone === "danger" ? "border-red-200 dark:border-red-900" : "border-neutral-200 dark:border-neutral-800"}`}
    >
      <h2 className="mb-3 font-medium">{title}</h2>
      {children}
    </section>
  );
}

function CurrencySelect({ local }: { local: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Moneda
      <select name="currency" defaultValue={local} className="input">
        <option value={local}>{local}</option>
        {local !== "USD" && <option value="USD">USD</option>}
      </select>
    </label>
  );
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string; opp: string }> }) {
  const { id, opp: oppId } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "oportunidad");
  const [opp, options] = await Promise.all([loadOpportunity(supabase, oppId), funnelOptions(supabase, id)]);
  if (!opp) notFound();

  const tz = business.timezone;
  const today = localDate(new Date().toISOString(), tz);
  const stageLabel = STAGES.find((s) => s.id === opp.stage)?.label;
  const won = isWonStage(opp.stage);
  const sale = opp.sale?.status === "vigente" ? opp.sale : null;
  const rate = business.usd_rate === null ? null : Number(business.usd_rate);

  // Cobrado neto en la moneda de la venta (o del negocio), con la cotización actual para mostrar.
  const showCurrency = sale?.currency ?? business.currency;
  let paid = 0;
  for (const p of opp.payments) {
    const value = convert({ amount: p.amount, currency: p.currency }, showCurrency, rate);
    if (value) paid += p.kind === "devolucion" ? -value.amount : value.amount;
  }
  const lastQuote = opp.quotes[0];
  const bind = <A extends unknown[], R>(fn: (businessId: string, oppId: string, ...args: A) => R) =>
    fn.bind(null, id, oppId) as (...args: A) => R;

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href={`/negocio/${id}/pipeline`} className="text-sm text-neutral-500 underline">
          ← Pipeline
        </Link>
        <header className="mb-6 mt-2">
          <p className="text-sm text-neutral-500">{stageLabel}</p>
          <h1 className="text-2xl font-semibold">{opp.need ?? "Sin detalle"}</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            {opp.contactName ?? "Cliente sin nombre"}
            {opp.phone && (
              <>
                {" · "}
                <a href={`https://wa.me/${opp.phone.slice(1)}`} className="underline" target="_blank" rel="noreferrer">
                  {opp.phone}
                </a>
              </>
            )}
          </p>
          <p className="text-xs text-neutral-500">
            {opp.entryKind === "venta_directa" ? "Venta directa (sin consulta previa)" : "Consulta"} del {formatDateTime(opp.createdAt, tz)} ·{" "}
            {opp.funnelName ? `${opp.funnelName} (${CONFIDENCE_LABELS[opp.attributionConfidence ?? "declarada"]})` : "Sin atribuir"}
            {opp.touchpoints.length > 0 && ` · también: ${opp.touchpoints.map((t) => t.funnelName).join(", ")}`}
          </p>
          {opp.stage === "perdido" && opp.lostReason && (
            <p className={`mt-1 text-sm ${opp.lostCategory === "cancelacion_tecnica" ? "text-warn" : "text-bad"}`}>
              Motivo: {opp.lostReason}
              {opp.lostCategory && opp.lostCategory !== "cancelacion_tecnica" && ` (${LOST_LABELS[opp.lostCategory]})`}
              {opp.lostCategory === "cancelacion_tecnica" && " · no cuenta como pérdida comercial"}
            </p>
          )}
        </header>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Presupuesto", lastQuote ? formatMoney({ [lastQuote.currency]: lastQuote.amount }) : "—"],
            ["Venta pactada", sale ? formatMoney({ [sale.currency]: sale.amount }) : "—"],
            ["Cobrado", formatMoney({ [showCurrency]: paid })],
            ["Saldo", sale ? formatMoney({ [sale.currency]: Math.max(sale.amount - paid, 0) }) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {!won && opp.stage !== "perdido" && (
            <>
              <Panel title="Ganar: el cliente aceptó y dejó el equipo">
                <ActionForm action={bind(winOpportunity)} submitLabel="Marcar ganada" className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Monto pactado
                    <input name="amount" inputMode="decimal" required defaultValue={lastQuote ? String(lastQuote.amount / 100) : ""} className="input" />
                  </label>
                  <CurrencySelect local={business.currency} />
                  <label className="flex flex-col gap-1 text-sm">
                    Cobrado ahora
                    <input name="paid" inputMode="decimal" placeholder="0" className="input" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Costo directo
                    <input name="cost" inputMode="decimal" placeholder="Opcional" className="input" />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-sm">
                    <input name="completed" type="checkbox" /> Ya está entregado (completado)
                  </label>
                </ActionForm>
              </Panel>

              <Panel title="Presupuesto">
                <ActionForm action={bind(addQuote)} submitLabel="Registrar presupuesto" className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Monto
                    <input name="amount" inputMode="decimal" required className="input" />
                  </label>
                  <CurrencySelect local={business.currency} />
                </ActionForm>
              </Panel>

              <Panel title="Seña">
                <p className="mb-3 text-xs text-neutral-500">Una seña sin compromiso firme no es venta: la oportunidad pasa a Señado.</p>
                <ActionForm action={bind(addPayment)} submitLabel="Registrar seña" className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Monto
                    <input name="amount" inputMode="decimal" required className="input" />
                  </label>
                  <CurrencySelect local={business.currency} />
                  <label className="col-span-2 flex flex-col gap-1 text-sm">
                    Medio de pago
                    <input name="method" placeholder="Efectivo, transferencia…" className="input" />
                  </label>
                </ActionForm>
              </Panel>

              <Panel title="Mover de etapa">
                <ActionForm action={bind(moveOpportunity)} submitLabel="Mover" className="grid grid-cols-1 gap-3">
                  <select name="stage" defaultValue={opp.stage} className="input">
                    {OPEN_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              </Panel>

              <Panel title="Próximo seguimiento">
                <ActionForm action={bind(updateFollowUp)} submitLabel="Guardar" className="grid grid-cols-1 gap-3">
                  <input
                    name="followUp"
                    type="date"
                    min={today}
                    defaultValue={opp.nextFollowUpAt ? localDate(opp.nextFollowUpAt, tz) : ""}
                    className="input"
                  />
                </ActionForm>
              </Panel>

              <Panel title="Perdido" tone="danger">
                <p className="mb-3 text-xs text-neutral-500">&ldquo;Lo voy a pensar&rdquo; no es perdido: dejala en seguimiento.</p>
                <ActionForm action={bind(loseOpportunity)} submitLabel="Marcar perdida" className="grid grid-cols-1 gap-3">
                  <select name="category" defaultValue="" className="input" aria-label="Categoría">
                    <option value="">¿Por qué se perdió?</option>
                    {Object.entries(LOST_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l[0].toUpperCase() + l.slice(1)}
                      </option>
                    ))}
                  </select>
                  <input name="reason" placeholder="Detalle (opcional)" className="input" />
                  {opp.payments.some((p) => p.kind === "sena") && (
                    <label className="flex items-center gap-2 text-sm">
                      <input name="refund" type="checkbox" defaultChecked={business.deposits_refundable} /> Devolver la seña
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input name="confirm" type="checkbox" /> Confirmo que el cliente no sigue
                  </label>
                </ActionForm>
              </Panel>
            </>
          )}

          {won && sale && (
            <>
              <Panel title="Cobro">
                <ActionForm action={bind(addPayment)} submitLabel="Registrar cobro" className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Monto
                    <input
                      name="amount"
                      inputMode="decimal"
                      required
                      defaultValue={sale.amount - paid > 0 ? String((sale.amount - paid) / 100) : ""}
                      className="input"
                    />
                  </label>
                  <CurrencySelect local={business.currency} />
                  <label className="col-span-2 flex flex-col gap-1 text-sm">
                    Medio de pago
                    <input name="method" placeholder="Efectivo, transferencia…" className="input" />
                  </label>
                </ActionForm>
              </Panel>

              {opp.stage === "ganado_en_reparacion" && (
                <Panel title="Entrega">
                  <ActionForm action={bind(moveOpportunity)} submitLabel="Marcar completado">
                    <input type="hidden" name="stage" value="ganado_completado" />
                  </ActionForm>
                </Panel>
              )}

              <Panel title="Costo directo">
                <p className="mb-3 text-xs text-neutral-500">
                  {sale.directCost === null ? "Sin cargar: la contribución de esta venta queda Sin datos." : `Cargado: ${formatMoney({ [sale.currency]: sale.directCost })}`}
                </p>
                <ActionForm action={updateCost.bind(null, id, oppId, sale.id)} submitLabel="Guardar costo" className="grid grid-cols-1 gap-3">
                  <input name="cost" inputMode="decimal" required className="input" placeholder="Repuesto, mano de obra externa…" />
                </ActionForm>
              </Panel>

              <Panel title="No se pudo hacer el trabajo" tone="danger">
                <p className="mb-3 text-xs text-neutral-500">
                  Cancelación técnica: no llegó el repuesto, el equipo no tenía arreglo… Se revierte la venta sin contarla como pérdida
                  por precio o seguimiento.
                </p>
                <ActionForm action={cancelJob.bind(null, id, oppId, sale.id)} submitLabel="Registrar cancelación técnica" className="grid grid-cols-1 gap-3">
                  <input name="reason" required placeholder="Qué pasó" className="input" />
                  <label className="flex items-center gap-2 text-sm">
                    <input name="refund" type="checkbox" defaultChecked /> Devolver lo cobrado
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input name="confirm" type="checkbox" /> Confirmo que el trabajo no se pudo hacer
                  </label>
                </ActionForm>
              </Panel>

              <Panel title="Revertir venta" tone="danger">
                <p className="mb-3 text-xs text-neutral-500">Para anulaciones o devoluciones. La venta queda en el historial como revertida.</p>
                <ActionForm action={reverseSale.bind(null, id, oppId, sale.id)} submitLabel="Revertir" className="grid grid-cols-1 gap-3">
                  <input name="reason" required placeholder="Motivo" className="input" />
                  <label className="flex items-center gap-2 text-sm">
                    <input name="refund" type="checkbox" defaultChecked /> Devolver lo cobrado
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input name="confirm" type="checkbox" /> Confirmo la reversión
                  </label>
                </ActionForm>
              </Panel>
            </>
          )}

          {opp.stage === "perdido" && (
            <Panel title="Reabrir">
              <p className="mb-3 text-xs text-neutral-500">Si el cliente volvió por lo mismo, reabrila: vuelve a En seguimiento.</p>
              <ActionForm action={bind(reopenOpportunity)} submitLabel="Reabrir">
                <span />
              </ActionForm>
            </Panel>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Embudo de origen">
            <ActionForm action={bind(assignFunnel)} submitLabel="Guardar origen" className="grid grid-cols-1 gap-3">
              <FunnelSelect options={options} label="Embudo principal" defaultValue={opp.funnelId ?? ""} />
              <label className="flex flex-col gap-1 text-sm">
                ¿Qué tan seguro es?
                <select name="confidence" defaultValue={opp.attributionConfidence ?? "declarada"} className="input">
                  <option value="confirmada">Confirmado (código, link o dato del sistema)</option>
                  <option value="declarada">Lo dijo el cliente o lo elegí yo</option>
                  <option value="inferida">Lo supongo</option>
                </select>
              </label>
              <input name="evidence" maxLength={300} defaultValue={opp.evidence ?? ""} placeholder="Cómo lo sabés (opcional)" className="input" />
            </ActionForm>
          </Panel>
          <Panel title="Otros puntos de contacto">
            <p className="mb-3 text-xs text-neutral-500">
              Si también lo influyó otra estrategia (vio un reel, lo recomendó alguien). Se muestra como influencia: no suma clientes ni
              facturación a ese embudo.
            </p>
            {opp.touchpoints.length > 0 && (
              <ul className="mb-3 text-sm">
                {opp.touchpoints.map((t) => (
                  <li key={t.id}>
                    {t.funnelName}
                    {t.evidence && <span className="text-neutral-500"> · {t.evidence}</span>}
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={bind(addTouchpoint)} submitLabel="Agregar" className="grid grid-cols-1 gap-3">
              <FunnelSelect options={options.filter((o) => o.value !== opp.funnelId)} label="Embudo" />
              <input name="evidence" maxLength={300} placeholder="Detalle (opcional)" className="input" />
            </ActionForm>
          </Panel>
        </div>

        <section className="mt-8">
          <h2 className="mb-2 font-medium">Movimientos</h2>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {opp.quotes.map((q) => (
              <li key={q.id} className="flex justify-between gap-3 px-3 py-2">
                <span>Presupuesto v{q.version} · {formatDateTime(q.quotedAt, tz)}</span>
                <span className="tabular-nums">{formatMoney({ [q.currency]: q.amount })}</span>
              </li>
            ))}
            {opp.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {PAYMENT_KIND_LABELS[p.kind] ?? p.kind}
                  {p.method ? ` (${p.method})` : ""} · {formatDateTime(p.paidAt, tz)}
                </span>
                <span className={`tabular-nums ${p.kind === "devolucion" ? "text-red-700 dark:text-red-400" : ""}`}>
                  {p.kind === "devolucion" ? "−" : ""}
                  {formatMoney({ [p.currency]: p.amount })}
                </span>
              </li>
            ))}
            {opp.sale && (
              <li className="flex justify-between gap-3 px-3 py-2">
                <span>
                  Venta {opp.sale.status === "revertida" ? "(revertida)" : ""} · {formatDateTime(opp.sale.wonAt, tz)}
                </span>
                <span className="tabular-nums">{formatMoney({ [opp.sale.currency]: opp.sale.amount })}</span>
              </li>
            )}
            {opp.quotes.length + opp.payments.length === 0 && !opp.sale && (
              <li className="px-3 py-2 text-neutral-500">Todavía no hay presupuestos ni cobros.</li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}
