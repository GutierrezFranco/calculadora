import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { LightBadge } from "@/components/light";
import { addDays, daysInPeriod, lastNDays, localDate } from "@/domain/dates";
import { computeMetrics } from "@/domain/metrics";
import { project, sensitivity, type Assumption, type ProjectionInputs, type ProjectionResult } from "@/domain/projection";
import { trafficLight } from "@/domain/traffic-light";
import { getBusinessForUser } from "@/lib/business-access";
import {
  loadAdSnapshots,
  loadBusinessData,
  loadGoals,
  loadProfileVisits,
  loadProspectStats,
  thresholdsOf,
} from "@/lib/data";
import { formatCount, formatMoney } from "@/lib/format";
import { defaultInputs, realValues, type RealValues } from "@/lib/projection-data";
import { saveScenario } from "./actions";

const KINDS = ["principal", "alternativo"] as const;

type FieldDef = {
  name: keyof RealValues | "prospectShare";
  label: string;
  unit: "money" | "percent";
  help?: string;
};

const FIELDS: FieldDef[] = [
  { name: "ticket", label: "Ticket promedio", unit: "money" },
  { name: "closeRate", label: "Consultas que terminan en venta (%)", unit: "percent" },
  { name: "margin", label: "Margen de contribución (%)", unit: "percent", help: "Solo para metas de contribución" },
  { name: "paidShare", label: "Consultas que llegan por anuncios (%)", unit: "percent" },
  { name: "costPerInquiry", label: "Costo por consulta de anuncios", unit: "money" },
  { name: "inquiriesPerVisit", label: "Consultas orgánicas por visita al perfil (%)", unit: "percent", help: "Hipotético: no es atribución" },
  { name: "prospectShare", label: "Ventas que buscás por prospección (%)", unit: "percent" },
  { name: "prospectConversion", label: "Prospectos contactados que compran (%)", unit: "percent" },
];

const editValue = (value: number | null, unit: FieldDef["unit"]) =>
  value === null ? "" : unit === "money" ? String(Math.round(value) / 100) : String(Math.round(value * 10_000) / 100).replace(".", ",");

function showValue(value: number | null, unit: FieldDef["unit"], currency: string) {
  if (value === null) return "—";
  return unit === "money" ? formatMoney({ [currency]: value }) : `${(Math.round(value * 1000) / 10).toLocaleString("es-AR")} %`;
}

function OriginTag({ a }: { a: Assumption }) {
  if (a.value === null) return null;
  return (
    <span className={`ml-1 rounded px-1 text-[10px] uppercase ${a.origin === "real" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"}`}>
      {a.origin}
    </span>
  );
}

export default async function ProjectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, business, supabase } = await getBusinessForUser(id, "proyeccion");
  const currency = business.currency;
  const today = localDate(new Date().toISOString(), business.timezone);
  const last90 = lastNDays(90, today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);

  const [data, ads, visits, prospects, goals, { data: saved }] = await Promise.all([
    loadBusinessData(supabase, business),
    loadAdSnapshots(supabase, id),
    loadProfileVisits(supabase, id, last90.from, last90.to),
    loadProspectStats(supabase, id),
    loadGoals(supabase, id, monthStart),
    supabase.from("projection_scenarios").select("kind, inputs").eq("business_id", id),
  ]);
  const thresholds = thresholdsOf(business);
  const real = realValues(data, last90, ads, visits, prospects, thresholds.minSample);
  const scenarios = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      ((saved ?? []).find((s) => s.kind === kind)?.inputs as ProjectionInputs | undefined) ?? defaultInputs(goals.facturacion, real),
    ]),
  ) as Record<(typeof KINDS)[number], ProjectionInputs>;
  const results = Object.fromEntries(KINDS.map((k) => [k, project(scenarios[k])])) as Record<(typeof KINDS)[number], ProjectionResult>;

  // Brecha: lo que va del mes contra lo necesario a este ritmo.
  const monthToDate = computeMetrics(data, { from: monthStart, to: today });
  const pace = daysInPeriod({ from: monthStart, to: today }) / daysInPeriod({ from: monthStart, to: monthEnd });
  const main = results.principal;
  const gapRows = [
    { label: "Ventas", needed: main.salesNeeded, actual: monthToDate.ventasGanadas },
    { label: "Consultas", needed: main.inquiriesNeeded, actual: monthToDate.consultasCalificadas },
  ];

  const resultRows: [string, (r: ProjectionResult) => string][] = [
    ["Facturación necesaria", (r) => (r.revenueNeeded === null ? "—" : formatMoney({ [currency]: r.revenueNeeded }))],
    ["Ventas", (r) => formatCount(r.salesNeeded)],
    ["· por prospección", (r) => formatCount(r.salesFromProspecting)],
    ["Consultas calificadas", (r) => formatCount(r.inquiriesNeeded)],
    ["· por anuncios", (r) => formatCount(r.paidInquiries)],
    ["· orgánicas", (r) => formatCount(r.organicInquiries)],
    ["Presupuesto de anuncios", (r) => (r.adBudget === null ? "—" : formatMoney({ [currency]: r.adBudget }))],
    ["Visitas al perfil (hipotético)", (r) => formatCount(r.profileVisitsNeeded)],
    ["Prospectos a contactar", (r) => formatCount(r.prospectContactsNeeded)],
  ];

  const grid = sensitivity(scenarios.principal);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Proyección de objetivos</h1>
        <p className="mb-6 max-w-3xl text-sm text-neutral-500">
          Desde la meta del mes, cuántas ventas, consultas, inversión y contactos hacen falta. Los supuestos marcados
          <span className="mx-1 rounded bg-green-100 px-1 text-[10px] uppercase text-green-800 dark:bg-green-950 dark:text-green-300">real</span>
          salen de tus datos de los últimos 90 días; los
          <span className="mx-1 rounded bg-neutral-200 px-1 text-[10px] uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">estimado</span>
          son tuyos. Es una estimación, no una promesa: ninguna cantidad de reels garantiza clientes.
        </p>

        <section className="mb-8 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2 font-medium">Para llegar a la meta necesitás</th>
                <th className="px-3 py-2 font-medium">Principal</th>
                <th className="px-3 py-2 font-medium">Alternativo</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {resultRows.map(([label, fn]) => (
                <tr key={label} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className={`px-3 py-1.5 ${label.startsWith("·") ? "pl-6 text-neutral-500" : ""}`}>{label.replace("· ", "")}</td>
                  <td className="px-3 py-1.5">{fn(results.principal)}</td>
                  <td className="px-3 py-1.5">{fn(results.alternativo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {KINDS.map((k) =>
            results[k].missing.length > 0 ? (
              <p key={k} className="border-t border-neutral-200 px-3 py-2 text-xs text-amber-700 dark:border-neutral-800 dark:text-amber-400">
                Escenario {k}: falta {results[k].missing.join(", ")}.
              </p>
            ) : null,
          )}
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-1 font-medium">Brecha de este mes (escenario principal)</h2>
            <p className="mb-3 text-xs text-neutral-500">Pasó el {Math.round(pace * 100)} % del mes.</p>
            <ul className="flex flex-col gap-2 text-sm">
              {gapRows.map((g) => (
                <li key={g.label} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {g.label}: {formatCount(g.actual)} de {formatCount(g.needed)}
                  </span>
                  <LightBadge
                    light={trafficLight({ actual: g.actual, target: g.needed, expectedFraction: pace, sample: monthToDate.consultasCalificadas, thresholds })}
                  />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-1 font-medium">Sensibilidad: consultas necesarias</h2>
            <p className="mb-3 text-xs text-neutral-500">Si el ticket y la tasa de cierre se mueven un poco (escenario principal).</p>
            <table className="w-full text-center text-sm tabular-nums">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="text-left font-medium">Ticket</th>
                  <th className="font-medium">Cierre −5 pts</th>
                  <th className="font-medium">Igual</th>
                  <th className="font-medium">Cierre +5 pts</th>
                </tr>
              </thead>
              <tbody>
                {[0.9, 1, 1.1].map((t) => (
                  <tr key={t}>
                    <td className="text-left text-xs text-neutral-500">{t === 1 ? "Igual" : t < 1 ? "−10 %" : "+10 %"}</td>
                    {[-0.05, 0, 0.05].map((c) => (
                      <td key={c} className={t === 1 && c === 0 ? "font-semibold" : ""}>
                        {formatCount(grid.find((g) => g.ticketFactor === t && g.closeDelta === c)?.inquiries ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {KINDS.map((kind) => {
            const s = scenarios[kind];
            return (
              <section key={kind} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <h2 className="mb-3 font-medium">Supuestos del escenario {kind}</h2>
                <ActionForm action={saveScenario.bind(null, id, kind)} submitLabel={`Guardar escenario ${kind}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Meta mensual de
                    <select name="goalKind" defaultValue={s.goalKind} className="input">
                      <option value="facturacion">Facturación</option>
                      <option value="contribucion">Contribución</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Meta ({currency})
                    <input name="goal" inputMode="decimal" required defaultValue={s.goal ? String(s.goal / 100) : ""} className="input" />
                  </label>
                  {FIELDS.map((f) => {
                    const a = s[f.name];
                    const realValue = f.name === "prospectShare" ? null : real[f.name];
                    return (
                      <label key={f.name} className="flex flex-col gap-1 text-sm">
                        <span>
                          {f.label}
                          <OriginTag a={a} />
                        </span>
                        <input name={f.name} inputMode="decimal" defaultValue={editValue(a.value, f.unit)} className="input" />
                        <input type="hidden" name={`real_${f.name}`} value={realValue === null ? "" : String(realValue)} />
                        <span className="text-xs text-neutral-500">
                          {realValue === null ? "Sin dato real suficiente" : `Real (90 días): ${showValue(realValue, f.unit, currency)}`}
                          {f.help ? ` · ${f.help}` : ""}
                        </span>
                      </label>
                    );
                  })}
                </ActionForm>
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
