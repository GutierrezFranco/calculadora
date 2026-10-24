import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { getBusinessForUser } from "@/lib/business-access";
import { formatDateTime, formatMoney } from "@/lib/format";
import { decideRow } from "../actions";

type Row = {
  id: string;
  row_number: number;
  data: Record<string, string | number | null>;
  match_reason: string | null;
  match_entity: "sale" | "opportunity" | "tally" | null;
  match_id: string | null;
  data_imports: { kind: string; file_name: string; created_at: string } | null;
};

/** Coincidencias dudosas de todas las importaciones: el alumno decide cada una. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "importar:revisar");
  const { data } = await supabase
    .from("ingestion_rows")
    .select("id, row_number, data, match_reason, match_entity, match_id, data_imports(kind, file_name, created_at)")
    .eq("business_id", id)
    .eq("status", "dudosa")
    .order("row_number")
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  const saleIds = rows.filter((r) => r.match_entity === "sale").map((r) => r.match_id!);
  const oppIds = rows.filter((r) => r.match_entity === "opportunity").map((r) => r.match_id!);
  const [{ data: sales }, { data: opps }] = await Promise.all([
    saleIds.length
      ? supabase.from("sales").select("id, amount, currency, won_at, description, contacts(name)").in("id", saleIds)
      : Promise.resolve({ data: [] }),
    oppIds.length ? supabase.from("opportunities").select("id, need, created_at, contacts(name)").in("id", oppIds) : Promise.resolve({ data: [] }),
  ]);
  type Existing = { id: string; amount?: number; currency?: string; won_at?: string; description?: string | null; need?: string | null; created_at?: string; contacts: { name: string | null } | null };
  const existing = new Map(([...(sales ?? []), ...(opps ?? [])] as unknown as Existing[]).map((e) => [e.id, e]));
  const tz = business.timezone;

  const describe = (d: Row["data"], kind: string) =>
    kind === "ventas"
      ? `${String(d.fecha).slice(0, 10)} · ${formatMoney({ [String(d.moneda)]: Number(d.monto) })}${d.descripcion ? ` · ${d.descripcion}` : ""}${d.cliente ? ` · ${d.cliente}` : ""}${d.telefono ? ` · ${d.telefono}` : ""}`
      : kind === "oportunidades"
        ? `${String(d.fecha).slice(0, 10)} · ${d.necesidad ?? "sin detalle"}${d.cliente ? ` · ${d.cliente}` : ""}${d.telefono ? ` · ${d.telefono}` : ""}`
        : `${d.fecha}: ${d.consultas} consultas`;

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href={`/negocio/${id}/importar`} className="text-sm font-semibold text-accent">
          ← Importar
        </Link>
        <h1 className="mb-1 mt-2 text-3xl font-extrabold tracking-tight">Revisar coincidencias</h1>
        <p className="mb-6 text-sm text-muted">
          Estas filas se parecen a algo que ya estaba cargado. Elegí qué hacer con cada una: nada se suma dos veces sin que lo
          confirmes.
        </p>
        {rows.length === 0 ? (
          <p className="card p-5 text-sm text-muted">No hay nada para revisar.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => {
              const kind = r.data_imports?.kind ?? "ventas";
              const e = r.match_id ? existing.get(r.match_id) : undefined;
              const linkLabel =
                r.match_entity === "opportunity" && kind === "ventas" ? "Es la venta de esa consulta" : r.match_entity === "tally" ? "Dejar el total que estaba" : "Es la misma";
              return (
                <li key={r.id} className="card flex flex-col gap-3 p-4 text-sm">
                  <p className="text-xs text-muted">
                    {r.data_imports?.file_name} · fila {r.row_number} · {formatDateTime(r.data_imports?.created_at ?? null, tz)}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-paper p-3">
                      <p className="label-muted">En el archivo</p>
                      <p className="font-semibold">{describe(r.data, kind)}</p>
                    </div>
                    <div className="rounded-xl bg-warn-soft p-3">
                      <p className="label-muted">Ya cargado</p>
                      <p className="font-semibold">
                        {e?.amount !== undefined
                          ? `${formatDateTime(e.won_at ?? null, tz)} · ${formatMoney({ [e.currency!]: Number(e.amount) })}${e.description ? ` · ${e.description}` : ""}`
                          : e?.need !== undefined
                            ? `Consulta del ${formatDateTime(e.created_at ?? null, tz)} · ${e.need ?? "sin detalle"}`
                            : r.match_reason}
                        {e?.contacts?.name && ` · ${e.contacts.name}`}
                      </p>
                      <p className="text-xs text-warn">{r.match_reason}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <form action={decideRow.bind(null, id, r.id, "vincular")}>
                      <button type="submit" className="btn-primary">
                        {linkLabel}
                      </button>
                    </form>
                    <form action={decideRow.bind(null, id, r.id, "importar")}>
                      <button type="submit" className="btn-secondary">
                        {r.match_entity === "tally" ? "Reemplazar por el del archivo" : "Son distintas: importar"}
                      </button>
                    </form>
                    <form action={decideRow.bind(null, id, r.id, "descartar")}>
                      <button type="submit" className="btn-secondary">
                        Descartar fila
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
