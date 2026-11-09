import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { MonthNav, parseMonth } from "@/components/ui";
import { localDate, monthName } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { simpleFunnelOptions } from "@/lib/funnel-choice";
import { saveMonthAds } from "./actions";
import { InquiryCounter } from "./inquiry-counter";
import { SpendField } from "./spend-field";

const units = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v / 100).replace(".", ","));

/** Publicidad del mes: por cada embudo, cuánto invirtió y cuántas consultas le generó. */
export default async function AdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { user, business, supabase } = await getBusinessForUser(id, "publicidad");
  const current = localDate(new Date().toISOString(), business.timezone).slice(0, 7);
  const month = parseMonth(query.mes, current);
  const [funnels, { data: rows }, { data: channels }] = await Promise.all([
    simpleFunnelOptions(supabase, id),
    supabase
      .from("funnel_months")
      .select("funnel_id, spend, inquiries, currency, followers, plays_3s, impressions")
      .eq("business_id", id)
      .eq("month", `${month}-01`),
    supabase.from("funnels").select("id, channel").eq("business_id", id),
  ]);
  const paid = new Set((channels ?? []).filter((f) => f.channel === "meta_ads").map((f) => f.id as string));
  const isPaid = (key: string) => paid.has(key) || key.startsWith("t:meta_");
  const byFunnel = new Map((rows ?? []).map((r) => [r.funnel_id as string, r]));

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <RefreshOnFocus />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Publicidad del mes</h1>
            <p className="mt-1 text-sm text-muted">Cuánto pusiste en cada embudo y cuántas consultas te trajo. Lo que no sepas, dejalo vacío (no es cero). Durante un live, tocá +1 por cada persona que te escribe.</p>
          </div>
          <MonthNav month={month} current={current} href={(m) => `/negocio/${id}/publicidad?mes=${m}`} />
        </header>

        <section className="card p-4 sm:p-6">
          <ActionForm key={month} action={saveMonthAds.bind(null, id)} submitLabel={`Guardar ${monthName(month)}`} className="flex flex-col gap-4">
            <input type="hidden" name="month" value={month} />
            {funnels.map((f) => {
              const r = f.value.startsWith("t:") ? undefined : byFunnel.get(f.value);
              const cur = r?.currency ?? business.currency;
              return (
                <fieldset key={f.value} className="grid grid-cols-2 gap-3 border-b border-soft pb-4 last:border-0">
                  <input type="hidden" name="row" value={f.value} />
                  <legend className="col-span-2 mb-1 font-bold">{f.label}</legend>
                  <SpendField fieldKey={f.value} label={f.label} local={business.currency} initialCurrency={cur} initialAmount={units(r?.spend)} />
                  <label className="text-sm">
                    Consultas que generó
                    <InquiryCounter businessId={id} funnelKey={f.value} month={month} initial={r?.inquiries ?? null} />
                  </label>
                  {isPaid(f.value) && (
                    <details className="col-span-2 text-sm" open={Boolean(r?.followers || r?.plays_3s || r?.impressions)}>
                      <summary className="cursor-pointer text-muted">Datos del anuncio (opcional): costo por seguidor y hook rate</summary>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <label>
                          Seguidores
                          <input name={`followers:${f.value}`} inputMode="numeric" defaultValue={r?.followers ?? ""} className="input mt-1 w-full" />
                        </label>
                        <label>
                          Reprod. 3 s
                          <input name={`plays:${f.value}`} inputMode="numeric" defaultValue={r?.plays_3s ?? ""} className="input mt-1 w-full" />
                        </label>
                        <label>
                          Impresiones
                          <input name={`impressions:${f.value}`} inputMode="numeric" defaultValue={r?.impressions ?? ""} className="input mt-1 w-full" />
                        </label>
                      </div>
                      <p className="mt-1 text-xs text-muted">Copialos de Meta (columnas «Seguidores», «Reproducciones de 3 segundos» e «Impresiones»).</p>
                    </details>
                  )}
                </fieldset>
              );
            })}
          </ActionForm>
        </section>

        <p className="text-sm text-muted">
          ¿Usás otro embudo? Activalo en{" "}
          <Link href={`/negocio/${id}/embudos`} className="font-semibold text-accent">
            Mis embudos
          </Link>{" "}
          o pedíselo a tu mentor. Después aparece acá.
        </p>
      </main>
    </>
  );
}
