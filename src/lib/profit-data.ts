import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { instantAt, shiftMonth } from "@/domain/dates";
import { computeFunnelProfit, type FunnelProfitReport } from "@/domain/funnel-profit";
import type { BusinessRow } from "@/lib/data";

/** Datos del mes para la rentabilidad por embudo: publicidad cargada + reparaciones y ventas con su origen. */
export async function loadFunnelProfit(supabase: SupabaseClient, business: BusinessRow, month: string): Promise<FunnelProfitReport> {
  const from = instantAt(`${month}-01`, 0, business.timezone);
  const to = instantAt(`${shiftMonth(month, 1)}-01`, 0, business.timezone);
  const [{ data: funnels }, { data: months }, { data: ops }] = await Promise.all([
    supabase.from("funnels").select("id, name, channel").eq("business_id", business.id),
    supabase.from("funnel_months").select("funnel_id, spend, inquiries").eq("business_id", business.id).eq("month", `${month}-01`),
    supabase
      .from("operations")
      .select("id, funnel_id, contact_id, commercial_status, agreed_amount, direct_cost, currency")
      .eq("business_id", business.id)
      .gte("occurred_at", from)
      .lt("occurred_at", to)
      .in("commercial_status", ["ganada", "pendiente"]),
  ]);
  const ids = (ops ?? []).map((o) => o.id as string);
  const collected = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: pays } = await supabase.from("payments").select("operation_id, amount, kind").eq("business_id", business.id).in("operation_id", ids.slice(i, i + 200));
    for (const p of pays ?? []) collected.set(p.operation_id, (collected.get(p.operation_id) ?? 0) + (p.kind === "devolucion" ? -p.amount : p.amount));
  }
  return computeFunnelProfit({
    currency: business.currency,
    funnels: (funnels ?? []).map((f) => ({ id: f.id, name: f.name, paid: f.channel === "meta_ads" })),
    months: (months ?? []).map((m) => ({ funnelId: m.funnel_id, spend: m.spend, inquiries: m.inquiries })),
    operations: (ops ?? []).map((o) => ({
      funnelId: o.funnel_id,
      contactId: o.contact_id,
      won: o.commercial_status === "ganada",
      amount: o.agreed_amount,
      cost: o.direct_cost,
      collected: collected.get(o.id) ?? null,
      currency: o.currency,
    })),
  });
}
