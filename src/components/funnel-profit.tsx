import Link from "next/link";
import type { FunnelProfitReport, FunnelProfitRow } from "@/domain/funnel-profit";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";

const plural = (n: number | null, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Rentabilidad por embudo: una tarjeta por embudo con lo que puso, lo que generó y lo que ganó. */
export function FunnelProfit({ report, currency, basePath, month }: { report: FunnelProfitReport; currency: string; basePath: string; month: string }) {
  const money = (v: number | null) => (v === null ? "—" : formatMoney({ [currency]: Math.round(v) }));
  const { rows, total } = report;
  return (
    <section aria-label="Rentabilidad por embudo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-extrabold">Rentabilidad por embudo</h2>
        <span className="flex gap-3 text-sm">
          <Link href={`${basePath}/publicidad?mes=${month}`} className="font-semibold text-accent">
            Cargar publicidad
          </Link>
          <Link href={`${basePath}/cargar`} className="font-semibold text-accent">
            Cargar reparación o venta
          </Link>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-5 text-sm text-muted">
          Todavía no hay nada este mes. Cargá tus reparaciones y ventas con su origen, y la publicidad del mes: el reporte se arma solo.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <Card key={r.funnelId ?? "none"} r={r} money={money} />
            ))}
          </div>
          <div className="card grid grid-cols-2 gap-x-6 gap-y-3 bg-ink p-5 text-white sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Invertiste" value={money(total.spend)} />
            <Stat label="Consultas" value={formatCount(total.inquiries)} />
            <Stat label="Clientes" value={formatCount(total.clients)} />
            <Stat label="Tasa de cierre" value={formatRatio(total.closeRate)} />
            <Stat label="Facturaste" value={money(total.billed)} />
            <Stat label="Ganancia" value={money(total.profit)} strong />
          </div>
          {report.otherCurrency > 0 && (
            <p className="text-xs text-muted">{report.otherCurrency} trabajos en otra moneda no se suman acá.</p>
          )}
        </>
      )}
    </section>
  );
}

function Card({ r, money }: { r: FunnelProfitRow; money: (v: number | null) => string }) {
  const good = r.profit >= 0;
  return (
    <article className="card flex flex-col gap-3 p-5">
      <header className="flex items-start justify-between gap-2">
        <h3 className="font-bold">{r.name}</h3>
        {r.roi !== null && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${good ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
            {good ? "+" : ""}
            {Math.round(r.roi * 100)} %
          </span>
        )}
      </header>
      <p className="text-sm leading-relaxed">
        {r.spend !== null ? (
          <>
            Invertiste <b>{money(r.spend)}</b>
            {r.inquiries !== null && (
              <>
                , te generó <b>{plural(r.inquiries, "consulta", "consultas")}</b>
              </>
            )}{" "}
            y cerraste <b>{plural(r.clients, "cliente", "clientes")}</b>.
          </>
        ) : (
          <>
            Cerraste <b>{plural(r.clients, "cliente", "clientes")}</b>
            {r.inquiries !== null && <> de {plural(r.inquiries, "consulta", "consultas")}</>}.
          </>
        )}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row k="Tasa de cierre" v={formatRatio(r.closeRate)} />
        <Row k="Costo por consulta" v={money(r.costPerInquiry)} />
        <Row k="Costo por cliente" v={money(r.costPerClient)} />
        <Row k="Facturaste" v={money(r.billed)} />
        <Row k="Repuestos / costo" v={money(r.cost)} />
        <Row k="Cobrado" v={money(r.collected)} />
      </dl>
      <div className="flex items-baseline justify-between border-t border-soft pt-3">
        <span className="text-sm font-semibold">Ganancia</span>
        <span className={`text-xl font-extrabold tabular-nums ${good ? "text-good" : "text-bad"}`}>{money(r.profit)}</span>
      </div>
      {r.roi !== null && (
        <p className="text-xs text-muted">
          Por cada $1 que pusiste en publicidad, {good ? "ganaste" : "perdiste"} ${Math.abs(r.roi).toFixed(2).replace(".", ",")}.
        </p>
      )}
      {(r.missing.length > 0 || r.withoutCost > 0 || r.withoutPrice > 0) && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {[
            r.missing.length > 0 && `Falta cargar ${r.missing.join(" y ")} del mes`,
            r.withoutCost > 0 && `${r.withoutCost} trabajos sin costo`,
            r.withoutPrice > 0 && `${r.withoutPrice} sin precio`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-semibold tabular-nums">{v}</dd>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-xl font-extrabold" : "text-lg font-bold"}`}>{value}</p>
    </div>
  );
}
