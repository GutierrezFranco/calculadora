import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { COMMERCIAL_LABELS, WORK_LABELS, operationPaid, paymentLabel } from "@/domain/operations";
import { getBusinessForUser } from "@/lib/business-access";
import { loadBusinessData } from "@/lib/data";
import { formatMoney } from "@/lib/format";

export default async function OperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "operaciones");
  const data = await loadBusinessData(supabase, business);
  const operations = [...(data.operations ?? [])].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
  return <><AppHeader user={user} businessId={id} /><main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-extrabold">Reparaciones y ventas</h1><Link href={`/negocio/${id}/cargar`} className="btn-primary">Registrar reparación o venta</Link></div>
    <p className="text-sm text-muted">Cada trabajo conserva su estado comercial, entrega y cobros. Podés registrar datos incompletos y completarlos después.</p>
    {operations.length === 0 && <p className="card p-5">Todavía no hay operaciones. Empezá con un trabajo que ya tengas.</p>}
    <ul className="flex flex-col gap-3">{operations.map((o) => <li key={o.id} className="card p-4">
      <Link className="font-bold text-accent" href={`/negocio/${id}/operaciones/${o.id}`}>{o.description}</Link>
      <p className="mt-1 text-sm text-muted">{o.occurredAt?.slice(0, 10) ?? "Fecha desconocida"} · {COMMERCIAL_LABELS[o.commercialStatus]} · {WORK_LABELS[o.workStatus]}</p>
      <p className="text-sm">{o.agreedAmount === null ? "Precio desconocido" : formatMoney({ [o.currency]: o.agreedAmount })} · {paymentLabel(o, operationPaid(o, data))}</p>
      <Link href={`/negocio/${id}/contactos/${o.contactId}`} className="mt-2 inline-block text-xs underline">Ver ficha del cliente</Link>
    </li>)}</ul>
  </main></>;
}
