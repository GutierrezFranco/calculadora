import { NextResponse, type NextRequest } from "next/server";
import { localDate } from "@/domain/dates";
import { STAGES } from "@/domain/pipeline";
import { PAYMENT_KIND_LABELS } from "@/components/options";
import { getCurrentUser } from "@/lib/auth";
import { getBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

type Value = string | number | null | undefined;

// Excel en español espera ";" como separador y coma decimal.
function csv(header: string[], rows: Value[][]): string {
  const cell = (v: Value) => {
    if (v === null || v === undefined) return "";
    const text = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

const money = (cents: number | null) => (cents === null ? null : Number(cents) / 100);
const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;

type Contact = { name: string | null; contact_phones: { phone_e164: string }[] } | null;

const KINDS = ["ventas", "oportunidades", "cobros", "consultas"] as const;

/** Descarga los datos del negocio en CSV. Las políticas de la base limitan qué se ve. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("tipo") as (typeof KINDS)[number] | null;
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: "tipo inválido" }, { status: 400 });

  const user = await getCurrentUser();
  const supabase = await createClient();
  const business = await getBusiness(supabase, id);
  if (!business) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  if (user.isMentor) await supabase.rpc("registrar_acceso_mentor", { target: id, resource: `exportar:${kind}` });

  const tz = business.timezone;
  const day = (iso: string | null) => (iso ? localDate(iso, tz) : null);
  let body: string;

  if (kind === "ventas") {
    const { data, error } = await supabase
      .from("sales")
      .select("won_at, amount, currency, direct_cost, status, usd_rate, description, opportunities(need, source, import_id), contacts(name, contact_phones(phone_e164))")
      .eq("business_id", id)
      .order("won_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    body = csv(
      ["Fecha", "Cliente", "Teléfono", "Detalle", "Monto", "Moneda", "Costo directo", "Estado", "Cotización USD", "Origen", "Carga"],
      (data ?? []).map((s) => {
        const opp = s.opportunities as unknown as { need: string | null; source: string; import_id: string | null } | null;
        const contact = s.contacts as unknown as Contact;
        return [
          day(s.won_at), contact?.name, contact?.contact_phones[0]?.phone_e164, s.description ?? opp?.need,
          money(s.amount), s.currency, money(s.direct_cost), s.status, s.usd_rate === null ? null : Number(s.usd_rate),
          opp?.source, opp?.import_id ? "importada" : "manual",
        ];
      }),
    );
  } else if (kind === "oportunidades") {
    const { data, error } = await supabase
      .from("opportunities")
      .select("created_at, stage, source, need, lost_at, lost_reason, next_follow_up_at, contacts(name, contact_phones(phone_e164))")
      .eq("business_id", id)
      .order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    body = csv(
      ["Creada", "Cliente", "Teléfono", "Necesidad", "Etapa", "Origen", "Próximo seguimiento", "Perdida", "Motivo"],
      (data ?? []).map((o) => {
        const contact = o.contacts as unknown as Contact;
        return [
          day(o.created_at), contact?.name, contact?.contact_phones[0]?.phone_e164, o.need, stageLabel(o.stage),
          o.source, day(o.next_follow_up_at), day(o.lost_at), o.lost_reason,
        ];
      }),
    );
  } else if (kind === "cobros") {
    const { data, error } = await supabase
      .from("payments")
      .select("paid_at, kind, amount, currency, method, usd_rate, opportunities(need, contacts(name))")
      .eq("business_id", id)
      .order("paid_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    body = csv(
      ["Fecha", "Tipo", "Monto", "Moneda", "Medio", "Cotización USD", "Cliente", "Detalle"],
      (data ?? []).map((p) => {
        const opp = p.opportunities as unknown as { need: string | null; contacts: { name: string | null } | null } | null;
        const sign = p.kind === "devolucion" ? -1 : 1;
        return [
          day(p.paid_at), PAYMENT_KIND_LABELS[p.kind] ?? p.kind, sign * (money(p.amount) ?? 0), p.currency, p.method,
          p.usd_rate === null ? null : Number(p.usd_rate), opp?.contacts?.name, opp?.need,
        ];
      }),
    );
  } else {
    const { data, error } = await supabase
      .from("inquiry_tallies")
      .select("date, count, method")
      .eq("business_id", id)
      .order("date");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    body = csv(["Fecha", "Consultas", "Carga"], (data ?? []).map((t) => [t.date, t.count, t.method]));
  }

  const fileName = `${business.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-${kind}-${localDate(new Date().toISOString(), tz)}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
