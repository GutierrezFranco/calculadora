import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { instantAt, shiftMonth } from "@/domain/dates";
import { computeFunnelProfit, NON_TRACEABLE_TEMPLATES, type FunnelProfitReport } from "@/domain/funnel-profit";
import type { BusinessRow } from "@/lib/data";

/** Datos del mes para la rentabilidad por embudo: publicidad cargada + reparaciones y ventas con su origen. */
export async function loadFunnelProfit(supabase: SupabaseClient, business: BusinessRow, month: string): Promise<FunnelProfitReport> {
  const from = instantAt(`${month}-01`, 0, business.timezone);
  const to = instantAt(`${shiftMonth(month, 1)}-01`, 0, business.timezone);
  const [{ data: funnels }, { data: months }, { data: ops }] = await Promise.all([
    supabase.from("funnels").select("id, name, channel, template_key").eq("business_id", business.id),
    supabase
      .from("funnel_months")
      .select("funnel_id, spend, inquiries, currency, usd_rate, followers, plays_3s, impressions")
      .eq("business_id", business.id)
      .eq("month", `${month}-01`),
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
  const rates = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [{ data: pays }, { data: sales }] = await Promise.all([
      supabase.from("payments").select("operation_id, amount, kind").eq("business_id", business.id).in("operation_id", chunk),
      // La cotización guardada al registrar la venta convierte lo vendido en dólares.
      supabase.from("sales").select("operation_id, usd_rate").eq("business_id", business.id).in("operation_id", chunk),
    ]);
    for (const p of pays ?? []) collected.set(p.operation_id, (collected.get(p.operation_id) ?? 0) + (p.kind === "devolucion" ? -p.amount : p.amount));
    for (const v of sales ?? []) if (v.usd_rate) rates.set(v.operation_id, Number(v.usd_rate));
  }
  return computeFunnelProfit({
    currency: business.currency,
    usdRate: business.usd_rate === null ? null : Number(business.usd_rate),
    funnels: (funnels ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      paid: f.channel === "meta_ads",
      traceable: !NON_TRACEABLE_TEMPLATES.includes(f.template_key),
    })),
    months: (months ?? []).map((m) => ({
      funnelId: m.funnel_id,
      spend: m.spend,
      inquiries: m.inquiries,
      currency: m.currency,
      usdRate: m.usd_rate === null ? null : Number(m.usd_rate),
      followers: m.followers,
      plays3s: m.plays_3s,
      impressions: m.impressions,
    })),
    operations: (ops ?? []).map((o) => ({
      funnelId: o.funnel_id,
      contactId: o.contact_id,
      won: o.commercial_status === "ganada",
      amount: o.agreed_amount,
      cost: o.direct_cost,
      collected: collected.get(o.id) ?? null,
      currency: o.currency,
      usdRate: rates.get(o.id) ?? null,
    })),
  });
}
