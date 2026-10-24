import Link from "next/link";
import type { FunnelReport, FunnelResult } from "@/domain/funnels";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";

function closeText(r: FunnelResult): string {
  const c = r.cohort;
  if (c.identificadas === 0) return "—";
  if (c.identificadas < 10) return `${c.ganadas} de ${c.identificadas}`;
  return formatRatio(c.ratio);
}

/** Resultados por embudo. Operaciones y facturación suman exacto; los clientes únicos van aparte. */
export function FunnelTable({ report, basePath }: { report: FunnelReport; basePath?: string }) {
  const rows = report.rows.filter((r) => r.consultas > 0 || r.ventas > 0 || r.funnel?.status === "activo");
  const s = report.sinAtribuir;
  const sumClients = rows.reduce((n, r) => n + r.clientes, 0) + s.clientes;
  return (
    <section aria-label="Resultados por embudo" className="card p-2 pb-4 sm:p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pb-2 pt-2">
        <h2 className="text-lg font-bold">Resultados por embudo</h2>
        {basePath && (
          <Link href={`${basePath}/embudos`} className="text-sm font-semibold text-accent">
            Ver mis embudos
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs font-semibold text-muted">
              <th className="px-3 py-2">Embudo</th>
              <th className="px-3 py-2 text-right">Consultas</th>
              <th className="px-3 py-2 text-right">Cierre</th>
              <th className="px-3 py-2 text-right">Operaciones</th>
              <th className="px-3 py-2 text-right">Clientes</th>
              <th className="px-3 py-2 text-right">Facturación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.funnel!.id} className="border-t border-soft">
                <td className="px-3 py-3 font-semibold">
                  {basePath ? (
                    <Link href={`${basePath}/embudos/${r.funnel!.id}`} className="text-ink hover:underline">
                      {r.funnel!.name}
                    </Link>
                  ) : (
                    r.funnel!.name
                  )}
                  {r.funnel!.status !== "activo" && <span className="ml-2 text-xs font-medium text-muted">({r.funnel!.status})</span>}
                </td>
                <td className="px-3 py-3 text-right">{formatCount(r.consultas)}</td>
                <td className="px-3 py-3 text-right">{closeText(r)}</td>
                <td className="px-3 py-3 text-right">
                  {r.ventas}
                  {r.ventasDirectas > 0 && <span className="block text-[11px] text-muted">{r.ventasDirectas} directas</span>}
                </td>
                <td className="px-3 py-3 text-right">{r.clientes}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatMoney(r.facturacion)}</td>
              </tr>
            ))}
            <tr className="border-t border-soft bg-[#FAF8F4] text-[#47433D]">
              <td className="px-3 py-3 font-semibold">
                Sin atribuir
                <span className="block text-[11px] font-normal text-muted">
                  {s.sinIdentificar > 0 ? `${s.sinIdentificar} solo en el total del día` : "sin origen confiable"}
                </span>
              </td>
              <td className="px-3 py-3 text-right">{formatCount(s.consultas)}</td>
              <td className="px-3 py-3 text-right">{closeText(s)}</td>
              <td className="px-3 py-3 text-right">
                {s.ventas}
                {s.ventasDirectas > 0 && <span className="block text-[11px] text-muted">{s.ventasDirectas} directas</span>}
              </td>
              <td className="px-3 py-3 text-right">{s.clientes}</td>
              <td className="px-3 py-3 text-right font-semibold">{formatMoney(s.facturacion)}</td>
            </tr>
            <tr className="border-t-2 border-line font-bold">
              <td className="px-3 py-3">Total del negocio</td>
              <td className="px-3 py-3 text-right">{formatCount(report.totals.consultas)}</td>
              <td className="px-3 py-3 text-right" />
              <td className="px-3 py-3 text-right">{report.totals.ventas}</td>
              <td className="px-3 py-3 text-right">{report.totals.clientesUnicos}</td>
              <td className="px-3 py-3 text-right">{formatMoney(report.totals.facturacion)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-3 pt-2 text-xs text-muted">
        Cada operación cuenta en un solo embudo (el principal), así que operaciones y facturación suman exacto.
        {sumClients !== report.totals.clientesUnicos &&
          ` Los clientes suman ${sumClients} entre embudos porque algunas personas compraron por más de uno; únicos: ${report.totals.clientesUnicos}.`}{" "}
        Con menos de 10 consultas el cierre se muestra como «x de y».
      </p>
    </section>
  );
}
