import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { getBusinessForUser } from "@/lib/business-access";
import { saveSettings } from "../actions";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business } = await getBusinessForUser(id, "configuracion");

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
      </main>
    </>
  );
}
