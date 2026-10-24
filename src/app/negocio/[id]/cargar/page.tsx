import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { FunnelSelect } from "@/components/funnel-select";
import { addDays, localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { funnelOptions } from "@/lib/funnel-choice";
import { quickSale, saveTally } from "../actions";


export default async function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "cargar");
  const today = localDate(new Date().toISOString(), business.timezone);

  const options = await funnelOptions(supabase, id);
  const { data: recent } = await supabase
    .from("inquiry_tallies")
    .select("date, count, method")
    .eq("business_id", id)
    .gte("date", addDays(today, -13))
    .order("date", { ascending: false });

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
          <h1 className="mb-1 text-lg font-semibold">Consultas del día</h1>
          <p className="mb-4 text-sm text-neutral-500">
            Cuántas personas consultaron con intención de comprar o reparar. No cuentes proveedores, conocidos ni
            spam, ni al mismo cliente que vuelve a escribir por lo mismo.
          </p>
          <ActionForm action={saveTally.bind(null, id)} submitLabel="Guardar consultas" className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Fecha
              <input name="date" type="date" defaultValue={today} max={today} required className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Consultas
              <input name="count" type="number" min={0} step={1} inputMode="numeric" required className="input" />
            </label>
          </ActionForm>

          <h2 className="mb-2 mt-6 text-sm font-medium text-neutral-500">Últimos 14 días</h2>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {Array.from({ length: 14 }, (_, i) => addDays(today, -i)).map((date) => {
              const tally = recent?.find((r) => r.date === date && r.method === "manual") ?? recent?.find((r) => r.date === date);
              return (
                <li key={date} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-neutral-500">{date.slice(5).split("-").reverse().join("/")}</span>
                  <span className={tally ? "" : "text-neutral-400"}>{tally ? tally.count : "sin cargar"}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
          <h1 className="mb-1 text-lg font-semibold">Venta rápida</h1>
          <p className="mb-4 text-sm text-neutral-500">
            Para ventas de mostrador, en un live o trabajos ya cerrados. Queda como venta ganada con lo que te pagaron.
          </p>
          <ActionForm action={quickSale.bind(null, id)} submitLabel="Registrar venta" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Qué vendiste
              <input name="description" placeholder="Cambio de módulo, cargador…" className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Monto de la venta
              <input name="amount" inputMode="decimal" required className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Moneda
              <select name="currency" defaultValue={business.currency} className="input">
                <option value={business.currency}>{business.currency}</option>
                {business.currency !== "USD" && <option value="USD">USD</option>}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cobrado ahora
              <input name="paid" inputMode="decimal" placeholder="Vacío = todo" className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Costo directo (repuesto)
              <input name="cost" inputMode="decimal" placeholder="Opcional" className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cliente
              <input name="contactName" placeholder="Opcional" className="input" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Teléfono
              <input name="phone" type="tel" placeholder="Opcional" className="input" />
            </label>
            <FunnelSelect options={options} />
            <label className="flex flex-col gap-1 text-sm">
              Fecha
              <input name="date" type="date" defaultValue={today} max={today} className="input" />
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input name="fromInquiry" type="checkbox" className="mt-1" />
              <span>
                Vino de una consulta que no cargué
                <span className="block text-xs text-muted">
                  Si no la marcás es una venta directa: suma facturación pero no consultas ni tasa de cierre.
                </span>
              </span>
            </label>
          </ActionForm>
        </section>
      </main>
    </>
  );
}
