import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { MonthNav, parseMonth } from "@/components/ui";
import { localDate, monthName, monthPeriod } from "@/domain/dates";
import { computeFunnelReport, type FunnelResult } from "@/domain/funnels";
import { getBusinessForUser } from "@/lib/business-access";
import { loadBusinessData, loadTemplates } from "@/lib/data";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";
import { activateTemplate, createCustomFunnel, setFunnelStatus } from "./actions";

const STATUS: Record<string, string> = { activo: "Activo", pausado: "Pausado", archivado: "Archivado" };

function stepChips(r: FunnelResult, currency: string) {
  const latest = r.actividad[0];
  const chips: { value: string; label: string; result?: boolean }[] = (latest?.steps ?? []).map((s) => ({
    value: s.unit === "dinero" ? formatMoney({ [currency]: s.value }) : formatCount(s.value),
    label: s.label + (s.quality === "estimado" ? " (estimado)" : ""),
  }));
  chips.push({ value: formatCount(r.consultas), label: "consultas", result: true });
  if (r.ventasDirectas > 0) chips.push({ value: String(r.ventasDirectas), label: "ventas directas", result: true });
  return chips;
}

export default async function FunnelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "embudos");
  const today = localDate(new Date().toISOString(), business.timezone);
  const month = parseMonth((await searchParams).mes, today.slice(0, 7));
  const [data, templates] = await Promise.all([loadBusinessData(supabase, business), loadTemplates(supabase)]);
  const report = computeFunnelReport(data, monthPeriod(month, today));
  const active = report.rows.filter((r) => r.funnel!.status !== "archivado");
  const used = new Set((data.funnels ?? []).map((f) => f.templateKey));
  const available = templates.filter((t) => !used.has(t.key));
  const s = report.sinAtribuir;
  const identified = report.totals.consultas - s.sinIdentificar;
  const attributed = identified - s.cohort.identificadas - s.cohort.cancelaciones;

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Mis embudos</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Cada embudo es una estrategia para conseguir clientes. Los pasos de arriba cambian según la estrategia; el
              final siempre es el mismo: consultas, clientes y plata. <span className="capitalize">{monthName(month)}</span> {month.slice(0, 4)}.
            </p>
          </div>
          <MonthNav month={month} current={today.slice(0, 7)} href={(mm) => `/negocio/${id}/embudos?mes=${mm}`} />
        </div>

        <section aria-label="Embudos" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {active.map((r) => {
            const f = r.funnel!;
            return (
              <article key={f.id} className="card flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{f.name}</h2>
                    <p className="text-[13px] text-muted">
                      {f.templateKey ? "Plantilla" : "A medida (configurado por tu mentor)"}
                      {f.versions.length > 1 && ` · versión ${f.versions[f.versions.length - 1].version} de los pasos`}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${f.status === "activo" ? "bg-soft text-[#47433D]" : "bg-warn-soft text-warn"}`}>
                    {STATUS[f.status]}
                  </span>
                </div>
                <ol className="flex flex-wrap gap-1.5">
                  {stepChips(r, business.currency).map((c) => (
                    <li key={c.label} className={`min-w-24 flex-1 rounded-xl px-3 py-2 ${c.result ? "bg-accent-soft" : "bg-paper"}`}>
                      <span className="block text-base font-bold tabular-nums">{c.value}</span>
                      <span className="block text-[11px] text-muted">{c.label}</span>
                    </li>
                  ))}
                </ol>
                {r.actividad.length === 0 && f.versions.some((v) => v.steps.length > 0) && (
                  <p className="text-xs font-semibold text-warn">Sin actividad cargada este mes</p>
                )}
                <div className="grid grid-cols-3 gap-3 border-t border-soft pt-3">
                  <div>
                    <span className="label-muted block">Clientes</span>
                    <span className="text-xl font-bold tabular-nums">{r.clientes}</span>
                  </div>
                  <div>
                    <span className="label-muted block">Facturación</span>
                    <span className="text-xl font-bold tabular-nums">{formatMoney(r.facturacion)}</span>
                  </div>
                  <div>
                    <span className="label-muted block">Cierre (cohorte)</span>
                    <span className="text-xl font-bold tabular-nums">
                      {r.cohort.identificadas >= 10 ? formatRatio(r.cohort.ratio) : r.cohort.identificadas ? `${r.cohort.ganadas} de ${r.cohort.identificadas}` : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/negocio/${id}/embudos/${f.id}?mes=${month}`} className="btn-primary">
                    Ver detalle
                  </Link>
                  {f.versions.some((v) => v.steps.length > 0) && (
                    <Link href={`/negocio/${id}/embudos/${f.id}#registrar`} className="btn-secondary">
                      Cargar actividad
                    </Link>
                  )}
                  <form action={setFunnelStatus.bind(null, id, f.id, f.status === "activo" ? "pausado" : "activo")}>
                    <button type="submit" className="btn-secondary">
                      {f.status === "activo" ? "Pausar" : "Reactivar"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}

          <article className="card flex flex-col gap-3 bg-[#FAF8F4] p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">Sin atribuir</h2>
              <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-semibold text-[#47433D]">No es un embudo</span>
            </div>
            <p className="text-sm leading-relaxed text-[#47433D]">
              {formatCount(s.consultas)} consultas no tienen un origen confiable: {s.sinIdentificar} entraron solo como total del
              día y {s.cohort.identificadas + s.cohort.cancelaciones} se cargaron sin origen. Aparecen acá para que la suma de
              embudos dé el total del negocio.
            </p>
            {report.totals.consultas > 0 && (
              <>
                <div className="h-2.5 overflow-hidden rounded-full bg-soft" aria-hidden>
                  <div className="h-full bg-accent" style={{ width: `${(attributed / report.totals.consultas) * 100}%` }} />
                </div>
                <span className="text-[13px] text-muted">
                  {formatRatio(attributed / report.totals.consultas)} de las consultas tiene embudo ({attributed} de {report.totals.consultas})
                </span>
              </>
            )}
            <Link href={`/negocio/${id}/pipeline?embudo=sin`} className="btn-secondary self-start">
              Asignar origen a las consultas cargadas
            </Link>
          </article>
        </section>

        {available.length > 0 && (
          <section aria-label="Plantillas" className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Otras estrategias que podés activar</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {available.map((t) => (
                <div key={t.key} className="card flex flex-col gap-2 p-4">
                  <span className="font-bold">{t.name}</span>
                  <span className="text-[13px] text-muted">{t.description}</span>
                  <form action={activateTemplate.bind(null, id, t.key)}>
                    <button type="submit" className="text-sm font-semibold text-accent">
                      Activar plantilla
                    </button>
                  </form>
                </div>
              ))}
              {!user.isMentor && (
                <div className="card flex flex-col gap-2 p-4">
                  <span className="font-bold">¿Necesitás otra estrategia?</span>
                  <span className="text-[13px] text-muted">Tu mentor arma embudos a medida, con los pasos que vos medís.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {user.isMentor && (
          <section aria-label="Embudo a medida" className="card p-5">
            <h2 className="mb-1 text-lg font-bold">Embudo a medida (mentor)</h2>
            <p className="mb-4 text-sm text-muted">
              Un paso por línea, con su unidad: <code>Lives | cantidad</code>, <code>Espectadores únicos | personas</code>,{" "}
              <code>Inversión | dinero</code>. Las consultas, clientes y facturación se agregan solos.
            </p>
            <ActionForm action={createCustomFunnel.bind(null, id)} submitLabel="Crear embudo" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Nombre
                <input name="name" required maxLength={80} className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Canal (para los reportes por origen)
                <select name="channel" defaultValue="organico" className="input">
                  <option value="organico">Orgánico</option>
                  <option value="meta_ads">Anuncios</option>
                  <option value="prospeccion">Prospección</option>
                  <option value="referido">Recomendación</option>
                  <option value="directo">Local</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                Pasos
                <textarea name="steps" rows={4} className="input" placeholder={"Sorteos | cantidad\nParticipantes | personas"} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="direct" /> Puede generar ventas sin consulta previa (ventas directas)
              </label>
            </ActionForm>
          </section>
        )}
      </main>
    </>
  );
}
