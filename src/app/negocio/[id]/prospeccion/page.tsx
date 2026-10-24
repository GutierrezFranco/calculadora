import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { loadProspectStats } from "@/lib/data";
import { formatCount, formatRatio } from "@/lib/format";
import { ImportWizard } from "../importar/import-wizard";
import { addProspect, convertProspect, setProspectStatus } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  no_contactado: "No contactado",
  contactado: "Contactado",
  respondio: "Respondió",
  interesado: "Interesado",
  oportunidad: "Oportunidad",
  cliente: "Cliente",
  descartado: "Descartado",
};
const EDITABLE = ["no_contactado", "contactado", "respondio", "interesado", "descartado"];

type Row = {
  id: string;
  name: string | null;
  company: string | null;
  phone_e164: string | null;
  city: string | null;
  data_origin: string | null;
  status: string;
  opportunity_id: string | null;
};

export default async function ProspectingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const filter = String((await searchParams).estado ?? "");
  const { user, business, supabase } = await getBusinessForUser(id, "prospeccion");

  let query = supabase
    .from("prospects")
    .select("id, name, company, phone_e164, city, data_origin, status, opportunity_id")
    .eq("business_id", id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (filter in STATUS_LABELS) query = query.eq("status", filter);
  const [{ data: rows }, stats] = await Promise.all([query, loadProspectStats(supabase, id)]);
  const prospects = (rows ?? []) as Row[];

  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  const tiles = [
    ["Prospectos", formatCount(stats.total), null],
    ["Contactados", formatCount(stats.contacted), null],
    ["Respondieron", formatCount(stats.responded), formatRatio(rate(stats.responded, stats.contacted))],
    ["Interesados", formatCount(stats.interested), formatRatio(rate(stats.interested, stats.responded))],
    ["Oportunidades", formatCount(stats.converted), formatRatio(rate(stats.converted, stats.interested))],
    ["Clientes", formatCount(stats.clients), formatRatio(rate(stats.clients, stats.converted))],
  ] as const;

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Prospección</h1>
        <p className="mb-6 max-w-3xl text-sm text-neutral-500">
          Clientes que salís a buscar (por ejemplo, otros talleres para venta por mayor). Registrá de dónde salió cada
          dato y respetá a quien no quiera recibir mensajes.
        </p>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map(([label, value, conv]) => (
            <div key={label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
              {conv && <p className="text-xs text-neutral-500">{conv} del paso anterior</p>}
            </div>
          ))}
        </section>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 font-medium">Agregar prospecto</h2>
            <ActionForm action={addProspect.bind(null, id)} submitLabel="Agregar" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input name="company" placeholder="Negocio" className="input" />
              <input name="name" placeholder="Contacto" className="input" />
              <input name="phone" type="tel" placeholder="Teléfono" className="input" />
              <input name="city" placeholder="Ciudad o zona" className="input" />
              <input name="origin" placeholder="De dónde salió el dato" className="input sm:col-span-2" />
            </ActionForm>
          </section>
          <details className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <summary className="cursor-pointer font-medium">Importar una base (Excel o CSV)</summary>
            <div className="mt-4">
              <ImportWizard
                businessId={id}
                timezone={business.timezone}
                currency={business.currency}
                today={localDate(new Date().toISOString(), business.timezone)}
                initialKind="prospectos"
              />
            </div>
          </details>
        </div>

        <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Filtrar por estado">
          <Link href={`/negocio/${id}/prospeccion`} className={filter ? "btn-secondary" : "btn-primary"}>
            Todos
          </Link>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <Link key={value} href={`/negocio/${id}/prospeccion?estado=${value}`} className={filter === value ? "btn-primary" : "btn-secondary"}>
              {label}
            </Link>
          ))}
        </nav>

        {prospects.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay prospectos{filter ? " en este estado" : ""}.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
            {prospects.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{p.company ?? p.name ?? p.phone_e164}</p>
                  <p className="text-xs text-neutral-500">
                    {[p.company ? p.name : null, p.city, p.data_origin && `Origen: ${p.data_origin}`].filter(Boolean).join(" · ")}
                    {p.phone_e164 && (
                      <>
                        {" · "}
                        <a href={`https://wa.me/${p.phone_e164.slice(1)}`} target="_blank" rel="noreferrer" className="underline">
                          {p.phone_e164}
                        </a>
                      </>
                    )}
                  </p>
                </div>
                {p.opportunity_id ? (
                  <Link href={`/negocio/${id}/pipeline/${p.opportunity_id}`} className="text-sm underline">
                    {STATUS_LABELS[p.status]}: ver en el pipeline
                  </Link>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setProspectStatus.bind(null, id, p.id)} className="flex items-center gap-2">
                      <select name="status" defaultValue={p.status} className="input py-1 text-sm" aria-label="Estado">
                        {EDITABLE.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-secondary">
                        Guardar
                      </button>
                    </form>
                    {p.status !== "descartado" && p.status !== "no_contactado" && (
                      <form action={convertProspect.bind(null, id, p.id)} className="flex items-center gap-2">
                        <input name="need" placeholder="Qué necesita" className="input py-1 text-sm" />
                        <button type="submit" className="btn-secondary">
                          Pasar al pipeline
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
