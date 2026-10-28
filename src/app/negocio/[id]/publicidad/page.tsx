import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { MonthNav, parseMonth } from "@/components/ui";
import { localDate, monthName } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { simpleFunnelOptions } from "@/lib/funnel-choice";
import { saveMonthAds } from "./actions";

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
  const [funnels, { data: rows }] = await Promise.all([
    simpleFunnelOptions(supabase, id),
    supabase.from("funnel_months").select("funnel_id, spend, inquiries").eq("business_id", id).eq("month", `${month}-01`),
  ]);
  const byFunnel = new Map((rows ?? []).map((r) => [r.funnel_id as string, r]));

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Publicidad del mes</h1>
            <p className="mt-1 text-sm text-muted">Cuánto pusiste en cada embudo y cuántas consultas te trajo. Los clientes cerrados salen solos de lo que cargás.</p>
          </div>
          <MonthNav month={month} current={current} href={(m) => `/negocio/${id}/publicidad?mes=${m}`} />
        </header>

        <section className="card p-4 sm:p-6">
          <ActionForm key={month} action={saveMonthAds.bind(null, id)} submitLabel={`Guardar ${monthName(month)}`} className="flex flex-col gap-4">
            <input type="hidden" name="month" value={month} />
            {funnels.map((f) => {
              const r = f.value.startsWith("t:") ? undefined : byFunnel.get(f.value);
              return (
                <fieldset key={f.value} className="grid grid-cols-2 gap-3 border-b border-soft pb-4 last:border-0">
                  <input type="hidden" name="row" value={f.value} />
                  <legend className="col-span-2 mb-1 font-bold">{f.label}</legend>
                  <label className="text-sm">
                    Inversión del mes · {business.currency}
                    <input name={`spend:${f.value}`} inputMode="decimal" defaultValue={units(r?.spend)} placeholder="$" className="input mt-1 w-full text-base" />
                  </label>
                  <label className="text-sm">
                    Consultas que generó
                    <input name={`inq:${f.value}`} inputMode="numeric" defaultValue={r?.inquiries ?? ""} placeholder="Cantidad" className="input mt-1 w-full text-base" />
                  </label>
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
