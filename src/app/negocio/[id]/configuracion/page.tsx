import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { loadGoals } from "@/lib/data";
import { saveGoals, saveSettings, saveThresholds } from "../actions";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "configuracion");
  const month = localDate(new Date().toISOString(), business.timezone).slice(0, 7);
  const goals = await loadGoals(supabase, id, `${month}-01`);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-6 text-2xl font-semibold">Configuración del negocio</h1>
        <ActionForm action={saveSettings.bind(null, id)} submitLabel="Guardar" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Nombre
            <input name="name" defaultValue={business.name} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Zona o ciudad
            <input name="zone" defaultValue={business.zone ?? ""} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Moneda local
            <input name="currency" defaultValue={business.currency} maxLength={3} required className="input uppercase" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cotización del dólar
            <input
              name="usdRate"
              inputMode="decimal"
              defaultValue={business.usd_rate === null ? "" : String(Number(business.usd_rate)).replace(".", ",")}
              placeholder="Moneda local por 1 USD"
              className="input"
            />
          </label>
          <p className="text-xs text-neutral-500 sm:col-span-2">
            Cada venta y cada cobro guardan la cotización que esté cargada en ese momento. Cambiarla no modifica lo ya
            registrado.
          </p>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input name="depositsRefundable" type="checkbox" defaultChecked={business.deposits_refundable} className="mt-1" />
            <span>
              Las señas se devuelven si el cliente no sigue
              <span className="block text-xs text-neutral-500">
                Si no está marcado, la seña de un cliente que no sigue queda como seña retenida.
              </span>
            </span>
          </label>
        </ActionForm>

        <h2 className="mb-1 mt-10 text-xl font-semibold">Objetivos del mes</h2>
        <p className="mb-4 text-sm text-neutral-500">Se comparan en el dashboard con lo que va del mes. Vacío = sin objetivo.</p>
        <ActionForm action={saveGoals.bind(null, id)} submitLabel="Guardar objetivos" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Mes
            <input name="month" type="month" defaultValue={month} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Facturación ({business.currency})
            <input
              name="facturacion"
              inputMode="decimal"
              defaultValue={goals.facturacion === null ? "" : String(goals.facturacion / 100)}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ventas
            <input name="ventas" type="number" min={0} defaultValue={goals.ventas ?? ""} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Consultas
            <input name="consultas" type="number" min={0} defaultValue={goals.consultas ?? ""} className="input" />
          </label>
        </ActionForm>

        <h2 className="mb-1 mt-10 text-xl font-semibold">Semáforos</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Comparan lo que va del mes con el ritmo necesario para llegar al objetivo. Con menos casos que la muestra mínima no
          se colorea, para no sacar conclusiones con pocos datos.
        </p>
        <ActionForm action={saveThresholds.bind(null, id)} submitLabel="Guardar semáforos" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Verde desde (% del ritmo)
            <input name="green" type="number" min={1} max={200} defaultValue={Math.round(Number(business.semaforo_verde) * 100)} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Amarillo desde (% del ritmo)
            <input name="yellow" type="number" min={1} max={200} defaultValue={Math.round(Number(business.semaforo_amarillo) * 100)} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Muestra mínima (consultas)
            <input name="minSample" type="number" min={0} defaultValue={business.muestra_minima} className="input" />
          </label>
        </ActionForm>

        <h2 className="mb-1 mt-10 text-xl font-semibold">Exportar datos</h2>
        <p className="mb-4 text-sm text-neutral-500">Archivos CSV que se abren con Excel o Google Sheets.</p>
        <div className="flex flex-wrap gap-2">
          {[
            ["ventas", "Ventas"],
            ["oportunidades", "Oportunidades"],
            ["cobros", "Cobros"],
            ["consultas", "Consultas"],
          ].map(([tipo, label]) => (
            <a key={tipo} href={`/negocio/${id}/exportar?tipo=${tipo}`} className="btn-secondary">
              {label}
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
