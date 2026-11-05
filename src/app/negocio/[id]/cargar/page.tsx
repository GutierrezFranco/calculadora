import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { simpleFunnelOptions } from "@/lib/funnel-choice";
import { SimpleOperationForm } from "./simple-form";

export default async function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "cargar");
  const today = localDate(new Date().toISOString(), business.timezone);
  const [funnels, { data: trades }] = await Promise.all([
    simpleFunnelOptions(supabase, id),
    // Equipos recibidos en canje que todavía no se vendieron (las ventas canceladas no cuentan)
    supabase
      .from("trade_ins")
      .select("id, description, value, currency, operations!trade_ins_business_id_received_operation_id_fkey(commercial_status)")
      .eq("business_id", id)
      .is("sold_operation_id", null)
      .order("created_at"),
  ]);
  const tradeIns = (trades ?? [])
    .filter((t) => (t.operations as unknown as { commercial_status: string } | null)?.commercial_status !== "cancelada")
    .map((t) => ({ id: t.id as string, description: t.description as string, value: Number(t.value), currency: t.currency as string }));

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <RefreshOnFocus />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-10">
        <header>
          <h1 className="text-2xl font-extrabold">Cargar reparación o venta</h1>
          <p className="mt-1 text-sm text-muted">Lo que no sepas, dejalo vacío. Con el origen de cada cliente se arma solo tu reporte de rentabilidad.</p>
        </header>
        <section className="card p-4 sm:p-6">
          <SimpleOperationForm businessId={id} currency={business.currency} today={today} funnels={funnels} tradeIns={tradeIns} />
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
