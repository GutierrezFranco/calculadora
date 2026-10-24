import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AppHeader } from "@/components/app-header";
import { localDate } from "@/domain/dates";
import { addTo, type MoneyTotals } from "@/domain/money";
import { getBusinessForUser } from "@/lib/business-access";
import { formatCount, formatMoney } from "@/lib/format";
import { addAccountMetrics, addAdMetrics, addCampaign, addContent, addContentMetrics, deleteMarketingRow } from "./actions";

const TABS = [
  ["contenido", "Contenido"],
  ["cuenta", "Cuenta"],
  ["anuncios", "Anuncios"],
] as const;

type Snapshot = { id: string; observed_on: string; views: number | null; reach: number | null; interactions: number | null; saves: number | null; shares: number | null; comments: number | null };
type Content = { id: string; url: string | null; platform: string; published_on: string; topic: string | null; angle: string | null; format: string | null; goal: string | null; content_metric_snapshots: Snapshot[] };
type AdSnapshot = { id: string; period_start: string; period_end: string; spend: number; currency: string; conversations: number | null };
type Campaign = { id: string; name: string; active: boolean; ad_metric_snapshots: AdSnapshot[] };

function DeleteButton({ businessId, table, rowId }: { businessId: string; table: string; rowId: string }) {
  return (
    <form action={deleteMarketingRow.bind(null, businessId, table, rowId)}>
      <button type="submit" className="text-xs text-neutral-500 underline" title="Borrar esta carga">
        Borrar
      </button>
    </form>
  );
}

const latest = (snapshots: Snapshot[]) => [...snapshots].sort((a, b) => b.observed_on.localeCompare(a.observed_on))[0] ?? null;

export default async function MarketingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const requested = String((await searchParams).tab ?? "contenido");
  const tab = TABS.some(([t]) => t === requested) ? requested : "contenido";
  const { user, business, supabase } = await getBusinessForUser(id, `marketing:${tab}`);
  const today = localDate(new Date().toISOString(), business.timezone);

  return (
    <>
      <AppHeader user={user} businessId={id} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-1 text-2xl font-semibold">Marketing</h1>
        <p className="mb-4 max-w-3xl text-sm text-neutral-500">
          Carga manual de métricas de contenido, de la cuenta y de anuncios. Cuando se conecten las APIs oficiales de
          Instagram y Meta, esto se completa solo.
        </p>
        <nav className="mb-6 flex gap-2" aria-label="Secciones">
          {TABS.map(([t, label]) => (
            <Link key={t} href={`/negocio/${id}/marketing?tab=${t}`} className={t === tab ? "btn-primary" : "btn-secondary"}>
              {label}
            </Link>
          ))}
        </nav>
        {tab === "contenido" && <ContentTab businessId={id} today={today} supabase={supabase} />}
        {tab === "cuenta" && <AccountTab businessId={id} today={today} supabase={supabase} />}
        {tab === "anuncios" && <AdsTab businessId={id} today={today} currency={business.currency} supabase={supabase} />}
      </main>
    </>
  );
}

type Supabase = Awaited<ReturnType<typeof getBusinessForUser>>["supabase"];

async function ContentTab({ businessId, today, supabase }: { businessId: string; today: string; supabase: Supabase }) {
  const { data } = await supabase
    .from("content_items")
    .select("id, url, platform, published_on, topic, angle, format, goal, content_metric_snapshots(id, observed_on, views, reach, interactions, saves, shares, comments)")
    .eq("business_id", businessId)
    .order("published_on", { ascending: false })
    .limit(200);
  const items = (data ?? []) as unknown as Content[];

  // Resumen por ángulo con la última medición de cada contenido.
  const byAngle = new Map<string, { count: number; views: number; measured: number }>();
  for (const item of items) {
    const key = item.angle ?? "sin ángulo";
    const row = byAngle.get(key) ?? { count: 0, views: 0, measured: 0 };
    row.count++;
    const snap = latest(item.content_metric_snapshots);
    if (snap?.views !== null && snap?.views !== undefined) {
      row.views += snap.views;
      row.measured++;
    }
    byAngle.set(key, row);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 font-medium">Nuevo contenido</h2>
        <ActionForm action={addContent.bind(null, businessId)} submitLabel="Agregar contenido" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input name="url" placeholder="Link" className="input sm:col-span-2" />
          <select name="platform" defaultValue="instagram" className="input">
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="facebook">Facebook</option>
            <option value="otro">Otro</option>
          </select>
          <label className="flex flex-col gap-1 text-sm">
            Publicado
            <input name="published" type="date" defaultValue={today} max={today} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ángulo (problema que muestra)
            <input name="angle" placeholder="pantalla rota, batería…" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Formato
            <input name="format" placeholder="descubrimiento, solución…" className="input" />
          </label>
          <input name="topic" placeholder="Tema" className="input" />
          <input name="goal" placeholder="Objetivo (consultas, seguidores…)" className="input sm:col-span-2" />
        </ActionForm>
      </section>

      {byAngle.size > 0 && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-1 font-medium">Por ángulo</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Mide el alcance del contenido, no las ventas: que una consulta hable del mismo problema que un reel no prueba
            que vino por ese reel.
          </p>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-neutral-500">
              <tr>
                <th className="py-1 font-medium">Ángulo</th>
                <th className="py-1 font-medium">Contenidos</th>
                <th className="py-1 font-medium">Vistas promedio</th>
              </tr>
            </thead>
            <tbody>
              {[...byAngle].map(([angle, r]) => (
                <tr key={angle} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1">{angle}</td>
                  <td className="py-1">{r.count}</td>
                  <td className="py-1">{r.measured ? formatCount(Math.round(r.views / r.measured)) : "Sin datos"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const snap = latest(item.content_metric_snapshots);
          return (
            <li key={item.id} className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {item.topic ?? item.angle ?? "Contenido"} · {item.platform} · {item.published_on}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {[item.angle && `Ángulo: ${item.angle}`, item.format, item.goal].filter(Boolean).join(" · ")}
                    {item.url && (
                      <>
                        {" · "}
                        <a href={item.url} target="_blank" rel="noreferrer" className="underline">
                          ver
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <DeleteButton businessId={businessId} table="content_items" rowId={item.id} />
              </div>
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                {snap
                  ? `Al ${snap.observed_on}: ${[
                      ["vistas", snap.views],
                      ["alcance", snap.reach],
                      ["interacciones", snap.interactions],
                      ["guardados", snap.saves],
                      ["compartidos", snap.shares],
                      ["comentarios", snap.comments],
                    ]
                      .filter(([, v]) => v !== null)
                      .map(([k, v]) => `${formatCount(v as number)} ${k}`)
                      .join(" · ")}`
                  : "Sin métricas cargadas"}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs underline">Cargar métricas</summary>
                <ActionForm action={addContentMetrics.bind(null, businessId, item.id)} submitLabel="Guardar métricas" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input name="observed" type="date" defaultValue={today} max={today} required className="input" aria-label="Fecha" />
                  <input name="views" inputMode="numeric" placeholder="Vistas" className="input" />
                  <input name="reach" inputMode="numeric" placeholder="Alcance" className="input" />
                  <input name="interactions" inputMode="numeric" placeholder="Interacciones" className="input" />
                  <input name="saves" inputMode="numeric" placeholder="Guardados" className="input" />
                  <input name="shares" inputMode="numeric" placeholder="Compartidos" className="input" />
                  <input name="comments" inputMode="numeric" placeholder="Comentarios" className="input" />
                  <input name="retention" inputMode="decimal" placeholder="Retención %" className="input" />
                </ActionForm>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function AccountTab({ businessId, today, supabase }: { businessId: string; today: string; supabase: Supabase }) {
  const { data } = await supabase
    .from("account_metric_snapshots")
    .select("id, platform, period_start, period_end, profile_visits, link_clicks, followers, reach")
    .eq("business_id", businessId)
    .order("period_end", { ascending: false })
    .limit(100);
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Métricas de la cuenta</h2>
        <p className="mb-3 text-xs text-neutral-500">Copiá los números del panel de Instagram para un rango de fechas (por ejemplo, la última semana).</p>
        <ActionForm action={addAccountMetrics.bind(null, businessId)} submitLabel="Guardar" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Desde
            <input name="from" type="date" max={today} required className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hasta
            <input name="to" type="date" defaultValue={today} max={today} required className="input" />
          </label>
          <input name="visits" inputMode="numeric" placeholder="Visitas al perfil" className="input" />
          <input name="clicks" inputMode="numeric" placeholder="Clics al enlace" className="input" />
          <input name="followers" inputMode="numeric" placeholder="Seguidores" className="input" />
          <input name="reach" inputMode="numeric" placeholder="Alcance" className="input" />
        </ActionForm>
      </section>
      {(data ?? []).length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full whitespace-nowrap text-sm tabular-nums">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900">
              <tr>
                {["Período", "Visitas al perfil", "Clics al enlace", "Seguidores", "Alcance", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((s) => (
                <tr key={s.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-3 py-1.5">
                    {s.period_start} al {s.period_end}
                  </td>
                  <td className="px-3 py-1.5">{formatCount(s.profile_visits)}</td>
                  <td className="px-3 py-1.5">{formatCount(s.link_clicks)}</td>
                  <td className="px-3 py-1.5">{formatCount(s.followers)}</td>
                  <td className="px-3 py-1.5">{formatCount(s.reach)}</td>
                  <td className="px-3 py-1.5">
                    <DeleteButton businessId={businessId} table="account_metric_snapshots" rowId={s.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function AdsTab({ businessId, today, currency, supabase }: { businessId: string; today: string; currency: string; supabase: Supabase }) {
  const { data } = await supabase
    .from("ad_campaigns")
    .select("id, name, active, ad_metric_snapshots(id, period_start, period_end, spend, currency, conversations)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  const campaigns = (data ?? []) as unknown as Campaign[];

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-1 font-medium">Nueva campaña</h2>
        <p className="mb-3 text-xs text-neutral-500">
          El costo por cliente se calcula en el dashboard: inversión / clientes cuyas oportunidades tienen origen
          &ldquo;Anuncios de Meta&rdquo;.
        </p>
        <ActionForm action={addCampaign.bind(null, businessId)} submitLabel="Crear campaña" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input name="name" required placeholder="Nombre de la campaña" className="input" />
        </ActionForm>
      </section>

      {campaigns.map((c) => {
        const spend: MoneyTotals = {};
        let conversations = 0;
        for (const s of c.ad_metric_snapshots) {
          addTo(spend, { amount: Number(s.spend), currency: s.currency });
          conversations += s.conversations ?? 0;
        }
        const local = spend[currency] ?? 0;
        return (
          <section key={c.id} className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{c.name}</h3>
                <p className="text-xs text-neutral-500">
                  Total: {formatMoney(spend)} · {formatCount(conversations)} conversaciones
                  {conversations > 0 && local > 0 && ` · ${formatMoney({ [currency]: Math.round(local / conversations) })} por conversación`}
                </p>
              </div>
              <DeleteButton businessId={businessId} table="ad_campaigns" rowId={c.id} />
            </div>
            <ul className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
              {[...c.ad_metric_snapshots]
                .sort((a, b) => b.period_end.localeCompare(a.period_end))
                .map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2 border-t border-neutral-200 py-1 dark:border-neutral-800">
                    <span>
                      {s.period_start} al {s.period_end}: {formatMoney({ [s.currency]: Number(s.spend) })} · {formatCount(s.conversations)} conversaciones
                    </span>
                    <DeleteButton businessId={businessId} table="ad_metric_snapshots" rowId={s.id} />
                  </li>
                ))}
            </ul>
            <details>
              <summary className="cursor-pointer text-xs underline">Cargar inversión de un período</summary>
              <ActionForm action={addAdMetrics.bind(null, businessId, c.id)} submitLabel="Guardar" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input name="from" type="date" max={today} required className="input" aria-label="Desde" />
                <input name="to" type="date" defaultValue={today} max={today} required className="input" aria-label="Hasta" />
                <input name="spend" inputMode="decimal" required placeholder="Inversión" className="input" />
                <select name="currency" defaultValue={currency} className="input" aria-label="Moneda">
                  <option value={currency}>{currency}</option>
                  {currency !== "USD" && <option value="USD">USD</option>}
                </select>
                <input name="conversations" inputMode="numeric" placeholder="Conversaciones" className="input" />
                <input name="impressions" inputMode="numeric" placeholder="Impresiones" className="input" />
                <input name="clicks" inputMode="numeric" placeholder="Clics" className="input" />
              </ActionForm>
            </details>
          </section>
        );
      })}
    </div>
  );
}
