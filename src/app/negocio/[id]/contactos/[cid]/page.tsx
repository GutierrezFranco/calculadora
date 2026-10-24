import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { STAGES } from "@/domain/pipeline";
import { getBusinessForUser } from "@/lib/business-access";
import { COMMERCIAL_LABELS, WORK_LABELS } from "@/domain/operations";
import { formatDateTime, formatMoney } from "@/lib/format";
import { addPhone, mergeContacts, updateContact } from "../actions";

type Contact = {
  id: string;
  name: string | null;
  notes: string | null;
  merged_into: string | null;
  first_contact_at: string | null;
  contact_phones: { phone_e164: string }[];
  opportunities: { id: string; need: string | null; stage: string; created_at: string }[];
  sales: { id: string; amount: number; currency: string; won_at: string; status: string }[];
};

const normalize = (s: string | null) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id, cid } = await params;
  const merged = (await searchParams).fusionado === "1";
  const { user, business, supabase } = await getBusinessForUser(id, "contacto");
  const columns = "id, name, notes, merged_into, first_contact_at, contact_phones(phone_e164), opportunities(id, need, stage, created_at), sales(id, amount, currency, won_at, status)";
  const { data } = await supabase.from("contacts").select(columns).eq("business_id", id).eq("id", cid).maybeSingle();
  if (!data) notFound();
  const contact = data as unknown as Contact;
  const { data: operations } = await supabase.from("operations").select("id, description, occurred_at, commercial_status, work_status")
    .eq("business_id", id).eq("contact_id", cid).order("occurred_at", { ascending: false });
  const operationIds = (operations ?? []).map((o) => o.id);
  const inquiryIds = contact.opportunities.map((o) => o.id);
  const filters = [operationIds.length ? `operation_id.in.(${operationIds.join(",")})` : "", inquiryIds.length ? `opportunity_id.in.(${inquiryIds.join(",")})` : ""].filter(Boolean);
  const { data: payments } = filters.length ? await supabase.from("payments").select("id, amount, currency, kind, paid_at")
    .eq("business_id", id).or(filters.join(",")).order("paid_at", { ascending: false }) : { data: [] };
  const tz = business.timezone;

  // Candidatos a duplicado: mismo nombre o teléfonos con los mismos últimos 8 dígitos.
  const { data: others } = await supabase
    .from("contacts")
    .select("id, name, contact_phones(phone_e164)")
    .eq("business_id", id)
    .is("merged_into", null)
    .neq("id", cid)
    .order("name")
    .limit(500);
  const tails = new Set(contact.contact_phones.map((p) => p.phone_e164.slice(-8)));
  const candidates = ((others ?? []) as { id: string; name: string | null; contact_phones: { phone_e164: string }[] }[]).map((o) => ({
    ...o,
    likely:
      (normalize(o.name) !== "" && normalize(o.name) === normalize(contact.name)) ||
      o.contact_phones.some((p) => tails.has(p.phone_e164.slice(-8))),
  }));
  candidates.sort((a, b) => Number(b.likely) - Number(a.likely));

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href={`/negocio/${id}/contactos`} className="text-sm text-neutral-500 underline">
          ← Contactos
        </Link>
        <h1 className="mb-1 mt-2 text-2xl font-semibold">{contact.name ?? "Sin nombre"}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {contact.contact_phones.map((p) => p.phone_e164).join(", ") || "Sin teléfono"} · primer contacto{" "}
          {(contact.first_contact_at ? formatDateTime(contact.first_contact_at, tz) : "Fecha desconocida")}
        </p>
        {merged && <p className="mb-4 rounded-md bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">Contactos fusionados.</p>}
        {contact.merged_into && (
          <p className="mb-4 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Este contacto se fusionó en{" "}
            <Link href={`/negocio/${id}/contactos/${contact.merged_into}`} className="underline">
              otro
            </Link>
            .
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 font-medium">Datos</h2>
            <ActionForm action={updateContact.bind(null, id, cid)} submitLabel="Guardar">
              <input name="name" defaultValue={contact.name ?? ""} placeholder="Nombre" className="input" />
              <textarea name="notes" defaultValue={contact.notes ?? ""} placeholder="Notas" rows={3} className="input" />
            </ActionForm>
            <h3 className="mb-2 mt-4 text-sm font-medium">Agregar teléfono</h3>
            <ActionForm action={addPhone.bind(null, id, cid)} submitLabel="Agregar">
              <input name="phone" type="tel" required className="input" />
            </ActionForm>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 font-medium">Historial</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {(operations ?? []).map((o) => <li key={o.id} className="mb-2">
                <Link className="font-semibold text-accent underline" href={`/negocio/${id}/operaciones/${o.id}`}>{o.description}</Link>
                <span className="block text-xs text-muted">{o.occurred_at?.slice(0, 10) ?? "Sin fecha"} · {COMMERCIAL_LABELS[o.commercial_status as keyof typeof COMMERCIAL_LABELS]} · {WORK_LABELS[o.work_status as keyof typeof WORK_LABELS]}</span>
              </li>)}
              {contact.opportunities.map((o) => (
                <li key={o.id}>
                  <Link href={`/negocio/${id}/pipeline/${o.id}`} className="underline">
                    {o.need ?? "Oportunidad"}
                  </Link>{" "}
                  <span className="text-neutral-500">· {STAGES.find((s) => s.id === o.stage)?.label}</span>
                </li>
              ))}
              {contact.sales
                .map((s) => (
                  <li key={s.id} className="text-neutral-600 dark:text-neutral-400">
                    {s.status === "revertida" ? "Venta revertida" : "Venta"} {formatMoney({ [s.currency]: Number(s.amount) })} · {formatDateTime(s.won_at, tz).split(",")[0]}
                  </li>
                ))}
              {(payments ?? []).map((p) => <li key={p.id} className="text-xs text-muted">{p.kind} · {formatMoney({ [p.currency]: Number(p.amount) })} · {p.paid_at?.slice(0, 10) ?? "Fecha desconocida"}</li>)}
              {contact.opportunities.length === 0 && !operations?.length && <li className="text-muted">Todavía no hay trabajos ni consultas.</li>}
            </ul>
          </section>
        </div>

        {!contact.merged_into && candidates.length > 0 && (
          <section className="mt-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-1 font-medium">Fusionar un duplicado</h2>
            <p className="mb-3 text-xs text-neutral-500">
              Si la misma persona quedó cargada dos veces, sus teléfonos, oportunidades y compras pasan a este contacto. El
              duplicado no se borra: queda apuntando acá.
            </p>
            <ActionForm action={mergeContacts.bind(null, id, cid)} submitLabel="Fusionar en este contacto" className="flex flex-col gap-3">
              <select name="remove" required defaultValue="" className="input">
                <option value="" disabled>
                  Elegí el duplicado…
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.likely ? "★ " : ""}
                    {c.name ?? "Sin nombre"} {c.contact_phones.map((p) => p.phone_e164).join(", ")}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input name="confirm" type="checkbox" /> Confirmo que son la misma persona
              </label>
            </ActionForm>
            {candidates.some((c) => c.likely) && <p className="mt-2 text-xs text-neutral-500">★ posible duplicado (mismo nombre o teléfono parecido).</p>}
          </section>
        )}
      </main>
    </>
  );
}
