import { SOURCE_LABELS, type AdsSummary, type SourceRow } from "@/domain/sources";
import { formatCount, formatMoney, formatRatio } from "@/lib/format";

/** Adquisición por canal: origen declarado en cada oportunidad, y costo de anuncios. */
export function Sources({ rows, ads }: { rows: SourceRow[]; ads: AdsSummary | null }) {
  return (
    <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-1 text-sm font-medium">Adquisición por canal</h2>
      <p className="mb-3 text-xs text-neutral-500">Según el origen que cargaste en cada oportunidad. Las ventas rápidas sin origen van como &ldquo;Sin dato&rdquo;.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Sin datos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Canal</th>
                <th className="py-1 pr-3 font-medium">Oportunidades</th>
                <th className="py-1 pr-3 font-medium">Ganadas</th>
                <th className="py-1 pr-3 font-medium">Tasa de cierre</th>
                <th className="py-1 pr-3 font-medium">Facturación</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.source} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1 pr-3">{SOURCE_LABELS[r.source]}</td>
                  <td className="py-1 pr-3">{formatCount(r.oportunidades)}</td>
                  <td className="py-1 pr-3">{formatCount(r.ganadas)}</td>
                  <td className="py-1 pr-3">{formatRatio(r.tasaCierre)}</td>
                  <td className="py-1 pr-3">{formatMoney(r.facturacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ads && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Inversión en anuncios", formatMoney(ads.spend)],
            ["Conversaciones (Meta)", formatCount(ads.conversations)],
            ["Costo por oportunidad", ads.costPerOpportunity ? formatMoney(ads.costPerOpportunity) : "Sin datos"],
            ["Costo por cliente", ads.costPerClient ? formatMoney(ads.costPerClient) : "Sin datos"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-neutral-500">{label}</p>
              <p className="font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
