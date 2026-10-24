import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { getBusinessForUser } from "@/lib/business-access";
import { formatDateTime } from "@/lib/format";

type Row = {
  id: string;
  name: string | null;
  first_contact_at: string;
  contact_phones: { phone_e164: string }[];
  opportunities: { id: string }[];
  sales: { status: string }[];
};

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const q = String((await searchParams).q ?? "").trim();
  const { user, business, supabase } = await getBusinessForUser(id, "contactos");

  let query = supabase
    .from("contacts")
    .select("id, name, first_contact_at, contact_phones(phone_e164), opportunities(id), sales(status)")
    .eq("business_id", id)
    .is("merged_into", null)
    .order("first_contact_at", { ascending: false })
    .limit(200);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const { data: byPhone } = digits.length >= 4
      ? await supabase.from("contact_phones").select("contact_id").eq("business_id", id).like("phone_e164", `%${digits}%`)
      : { data: [] as { contact_id: string }[] };
    const ids = (byPhone ?? []).map((p) => p.contact_id);
    const safe = q.replace(/[%_,()]/g, " ");
    query = ids.length ? query.or(`name.ilike.%${safe}%,id.in.(${ids.join(",")})`) : query.ilike("name", `%${safe}%`);
  }
  const { data } = await query;
  const contacts = (data ?? []) as unknown as Row[];

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Contactos</h1>
        <p className="mb-4 text-sm text-neutral-500">Personas que consultaron o compraron. Si alguien aparece dos veces, abrilo y fusionalo.</p>
        <form className="mb-4 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Buscar por nombre o teléfono" className="input flex-1" />
          <button type="submit" className="btn-secondary">
            Buscar
          </button>
        </form>
        {contacts.length === 0 ? (
          <p className="text-sm text-neutral-500">{q ? "No se encontró ningún contacto." : "Todavía no hay contactos."}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {contacts.map((c) => (
              <li key={c.id}>
                <Link href={`/negocio/${id}/contactos/${c.id}`} className="flex flex-wrap justify-between gap-2 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <span>
                    <span className="font-medium">{c.name ?? "Sin nombre"}</span>
                    <span className="ml-2 text-neutral-500">{c.contact_phones.map((p) => p.phone_e164).join(", ")}</span>
                  </span>
                  <span className="text-xs text-neutral-500">
                    {c.opportunities.length} oportunidades · {c.sales.filter((s) => s.status === "vigente").length} compras · desde{" "}
                    {formatDateTime(c.first_contact_at, business.timezone).split(",")[0]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
