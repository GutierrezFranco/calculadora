import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { simpleFunnelOptions } from "@/lib/funnel-choice";
import { SimpleOperationForm } from "./simple-form";

export default async function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "cargar");
  const today = localDate(new Date().toISOString(), business.timezone);
  const funnels = await simpleFunnelOptions(supabase, id);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header>
          <h1 className="text-2xl font-extrabold">Cargar reparación o venta</h1>
          <p className="mt-1 text-sm text-muted">Lo que no sepas, dejalo vacío. Con el origen de cada cliente se arma solo tu reporte de rentabilidad.</p>
        </header>
        <section className="card p-4 sm:p-6">
          <SimpleOperationForm businessId={id} currency={business.currency} today={today} funnels={funnels} />
        </section>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/negocio/${id}/operaciones`} className="font-semibold text-accent">
            Ver y corregir lo que cargué →
          </Link>
          <Link href={`/negocio/${id}/publicidad`} className="font-semibold text-accent">
            Cargar publicidad del mes →
          </Link>
        </p>
      </main>
    </>
  );
}
