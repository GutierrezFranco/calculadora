import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { FunnelSelect } from "@/components/funnel-select";
import { localDate } from "@/domain/dates";
import { getBusinessForUser } from "@/lib/business-access";
import { funnelOptions } from "@/lib/funnel-choice";
import { createOpportunity } from "../actions";

export default async function NewOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "pipeline");
  const options = await funnelOptions(supabase, id);
  const today = localDate(new Date().toISOString(), business.timezone);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-3xl font-extrabold tracking-tight">Nueva oportunidad</h1>
        <p className="mb-6 text-sm text-muted">
          Una oportunidad es una necesidad concreta de un cliente. Si la misma persona vuelve a escribir por lo mismo,
          seguí la oportunidad que ya existe.
        </p>
        <ActionForm action={createOpportunity.bind(null, id)} submitLabel="Crear oportunidad" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Qué necesita
            <input name="need" required placeholder="Cambio de pantalla iPhone 13" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cliente
            <input name="contactName" placeholder="Opcional" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Teléfono
            <input name="phone" type="tel" placeholder="Recomendado" className="input" />
          </label>
          <FunnelSelect options={options} />
          <label className="flex flex-col gap-1 text-sm">
            ¿Cómo lo sabés? (opcional)
            <input name="evidence" maxLength={300} placeholder="Lo dijo el cliente, vino con el código LIVE10…" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Fecha de la consulta
            <input name="date" type="date" defaultValue={today} max={today} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Próximo seguimiento
            <input name="followUp" type="date" min={today} className="input" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input name="otherNeed" type="checkbox" />
            Es otra necesidad del mismo cliente
          </label>
        </ActionForm>
      </main>
    </>
  );
}
