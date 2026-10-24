import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { operationPaid } from "@/domain/operations";
import { getBusinessForUser } from "@/lib/business-access";
import { loadBusinessData } from "@/lib/data";
import { OperationForm } from "../operation-form";

export default async function OperationPage({ params }: { params: Promise<{ id: string; op: string }> }) {
  const { id, op } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "operacion");
  const data = await loadBusinessData(supabase, business);
  const operation = data.operations?.find((o) => o.id === op);
  if (!operation) notFound();
  const { data: customer } = await supabase.from("contacts").select("id, name, contact_phones(phone_e164)").eq("business_id", id).eq("id", operation.contactId).single();
  if (!customer) notFound();
  const payments = data.payments.filter((p) => p.operationId === op);
  return <><AppHeader user={user} businessId={id} /><main className="mx-auto max-w-2xl px-4 py-6">
    <Link href={`/negocio/${id}/operaciones`} className="text-sm text-accent">← Reparaciones y ventas</Link>
    <h1 className="mb-5 mt-3 text-2xl font-extrabold">Detalle de la operación</h1>
    <OperationForm requestId={crypto.randomUUID()} businessId={id} currency={business.currency} today={localDate(new Date().toISOString(), business.timezone)}
      funnels={(data.funnels ?? []).map((f) => ({ id: f.id, name: f.name }))} initial={operation}
      initialCustomer={{ id: customer.id, name: customer.name, phones: customer.contact_phones.map((p: { phone_e164: string }) => p.phone_e164) }} initialPaid={operationPaid(operation, data)} />
    <section className="card mt-6 p-4 text-sm"><h2 className="font-bold">Historial de cobros y devoluciones</h2>
      <p className="my-2 text-muted">Se conservan los movimientos originales. Los importes sin fecha no se asignan a un mes.</p>
      <ul>{payments.map((p) => <li key={p.id}>{p.paidAt?.slice(0, 10) ?? "Sin fecha"} · {p.kind} · {p.amount.currency} {(p.amount.amount / 100).toLocaleString("es-AR")}</li>)}</ul>
      <Link className="mt-3 inline-block text-accent underline" href={`/negocio/${id}/contactos/${operation.contactId}`}>Ver historial del cliente</Link>
    </section>
  </main></>;
}
