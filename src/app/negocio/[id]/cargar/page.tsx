import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import Link from "next/link";
import { OperationForm } from "../operaciones/operation-form";
import { addDays, localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";

import { saveTally } from "../actions";


export default async function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "cargar");
  const today = localDate(new Date().toISOString(), business.timezone);

  const { data: funnels } = await supabase.from("funnels").select("id, name").eq("business_id", id).eq("status", "activo").order("name");
  const { data: recent } = await supabase
    .from("inquiry_tallies")
    .select("date, count, method")
    .eq("business_id", id)
    .gte("date", addDays(today, -13))
    .order("date", { ascending: false });

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header><h1 className="text-2xl font-extrabold">Registrar reparación o venta</h1>
          <p className="mt-2 text-sm text-muted">Cargá los trabajos que ya tenés. No hace falta usar el pipeline. Lo que no sabés puede quedar vacío.</p>
          <Link href={`/negocio/${id}/operaciones`} className="mt-3 inline-block text-sm font-semibold text-accent">Ver y corregir mis operaciones →</Link>
        </header>
        <section className="card p-4 sm:p-6">
          <OperationForm requestId={crypto.randomUUID()} businessId={id} currency={business.currency} today={today} funnels={funnels ?? []} />
        </section>
        <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">También puedo cargar consultas del día</summary>
          <p className="my-3 text-sm text-muted">Contá intenciones comerciales distintas. No sumes otra consulta por cada reparación del mismo pedido.</p>
          <ActionForm action={saveTally.bind(null, id)} submitLabel="Guardar consultas" className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm">Fecha<input name="date" type="date" defaultValue={today} max={today} required className="input mt-1 w-full" /></label>
            <label className="text-sm">Consultas<input name="count" type="number" min={0} step={1} required className="input mt-1 w-full" /></label>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">{recent?.length ?? 0} días con registros en las últimas dos semanas.</p>
        </details>
      </main>
    </>
  );
}
