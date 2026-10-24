"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { localDate } from "@/domain/dates";
import {
  googleSheetCsvUrl,
  parseOpportunities,
  parseSales,
  parseTallies,
  type ImportKind,
  type Mapping,
  type OpportunityImportRow,
  type ProspectImportRow,
  type SaleImportRow,
  type TallyImportRow,
} from "@/domain/import";
import { getBusiness, type BusinessRow } from "@/lib/data";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type ImportResult = { ok: boolean; message: string; duplicate?: boolean };

const MAX_ROWS = 5000;
const MAX_SHEET_BYTES = 5_000_000;
const isInt = (v: unknown, min = 0) => typeof v === "number" && Number.isInteger(v) && v >= min;
const shortText = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.length <= 200);
const PHONE = /^\+[1-9]\d{6,14}$/;

/** Revalida en el servidor lo que armó el navegador: nunca se confía en el cliente. */
function invalidSale(r: SaleImportRow, currency: string): boolean {
  return (
    Number.isNaN(Date.parse(r.fecha)) ||
    !isInt(r.monto, 1) ||
    !(r.cobrado === null || (isInt(r.cobrado) && r.cobrado <= r.monto)) ||
    !(r.costo === null || isInt(r.costo)) ||
    !(r.moneda === currency || r.moneda === "USD") ||
    !(r.telefono === null || PHONE.test(r.telefono)) ||
    !shortText(r.descripcion) ||
    !shortText(r.cliente) ||
    !shortText(r.externalId)
  );
}

function invalidOpportunity(r: OpportunityImportRow): boolean {
  return (
    Number.isNaN(Date.parse(r.fecha)) ||
    !(r.telefono === null || PHONE.test(r.telefono)) ||
    ![r.necesidad, r.cliente, r.externalId].every(shortText) ||
    !(r.necesidad || r.cliente || r.telefono)
  );
}

function invalidProspect(r: ProspectImportRow): boolean {
  return (
    !(r.telefono === null || PHONE.test(r.telefono)) ||
    !(r.email === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) ||
    ![r.nombre, r.empresa, r.ciudad, r.origen].every(shortText) ||
    !(r.nombre || r.empresa || r.telefono)
  );
}

function invalidTally(r: TallyImportRow): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha) || !isInt(r.consultas);
}

async function context(businessId: string) {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) throw new Error("No tenés acceso a este negocio");
  return { supabase, business };
}

const NOUN: Record<ImportKind, string> = { ventas: "ventas", consultas: "días de consultas", prospectos: "prospectos", oportunidades: "consultas" };

/** Base de prospección: deduplica por teléfono en la base (circuito propio). */
export async function importProspects(
  businessId: string,
  payload: { fileName: string; fileHash: string; rows: ProspectImportRow[] },
): Promise<ImportResult> {
  const { supabase } = await context(businessId);
  const { rows } = payload;
  if (rows.length === 0) return { ok: false, message: "No hay filas válidas para importar" };
  if (rows.length > MAX_ROWS) return { ok: false, message: `Máximo ${MAX_ROWS} filas por archivo: dividilo en partes` };
  const bad = rows.findIndex(invalidProspect);
  if (bad >= 0) return { ok: false, message: `La fila ${bad + 1} tiene datos inválidos` };
  const importId = crypto.randomUUID();
  const { error: importError } = await supabase.from("data_imports").insert({
    id: importId,
    business_id: businessId,
    kind: "prospectos",
    file_name: payload.fileName.slice(0, 200),
    file_hash: payload.fileHash,
    rows_total: rows.length,
  });
  if (importError) return { ok: false, message: importError.message };
  const { data: count, error } = await supabase.rpc("importar_prospectos", { p_import: importId, p_rows: rows });
  if (error) return { ok: false, message: `No se importó nada: ${error.message}` };
  revalidatePath(`/negocio/${businessId}`, "layout");
  const skipped = count < rows.length ? ` (${rows.length - count} ya estaban cargados)` : "";
  return { ok: true, message: `Listo: se importaron ${count} prospectos${skipped}.` };
}

export interface Prepared {
  ok: boolean;
  message: string;
  importId?: string;
  counts?: { nueva: number; duplicada: number; dudosa: number };
}

type StageRow = { row: number; data: Record<string, unknown>; external_id?: string | null };

function stageRows(kind: ImportKind, rows: unknown[], business: BusinessRow, funnel: string | null): StageRow[] | string {
  if (kind === "ventas") {
    const sales = rows as SaleImportRow[];
    const bad = sales.findIndex((r) => invalidSale(r, business.currency));
    if (bad >= 0) return `La fila ${sales[bad].row ?? bad + 1} tiene datos inválidos`;
    return sales.map((r, i) => ({
      row: r.row ?? i + 1,
      external_id: r.externalId ?? null,
      data: {
        fecha: r.fecha, monto: r.monto, cobrado: r.cobrado, costo: r.costo, descripcion: r.descripcion,
        cliente: r.cliente, telefono: r.telefono, moneda: r.moneda, embudo: funnel,
      },
    }));
  }
  if (kind === "oportunidades") {
    const opps = rows as OpportunityImportRow[];
    const bad = opps.findIndex(invalidOpportunity);
    if (bad >= 0) return `La fila ${opps[bad].row ?? bad + 1} tiene datos inválidos`;
    return opps.map((r, i) => ({
      row: r.row ?? i + 1,
      external_id: r.externalId,
      data: { fecha: r.fecha, necesidad: r.necesidad, cliente: r.cliente, telefono: r.telefono, embudo: funnel },
    }));
  }
  const tallies = rows as TallyImportRow[];
  if (tallies.some(invalidTally)) return "Hay días con datos inválidos";
  return tallies.map((r, i) => ({ row: i + 1, data: { fecha: r.fecha, consultas: r.consultas } }));
}

/**
 * Paso 1 del circuito común: crea el lote y prepara las filas (deduplicación y
 * coincidencias dudosas). Todavía no se crea ninguna venta ni consulta.
 */
export async function prepareImport(
  businessId: string,
  payload: {
    kind: ImportKind;
    channel: "archivo" | "google_sheets";
    fileName: string;
    fileHash: string;
    sourceSystem?: string;
    sourceId?: string | null;
    funnelId: string | null;
    rows: unknown[];
  },
): Promise<Prepared> {
  const { supabase, business } = await context(businessId);
  const { kind, rows } = payload;
  if (!["ventas", "consultas", "oportunidades"].includes(kind)) return { ok: false, message: "Tipo de importación inválido" };
  if (rows.length === 0) return { ok: false, message: "No hay filas válidas para importar" };
  if (rows.length > MAX_ROWS) return { ok: false, message: `Máximo ${MAX_ROWS} filas por archivo: dividilo en partes` };
  if (payload.funnelId && !/^[0-9a-f-]{36}$/.test(payload.funnelId)) return { ok: false, message: "Embudo inválido" };
  const staged = stageRows(kind, rows, business, payload.funnelId);
  if (typeof staged === "string") return { ok: false, message: staged };

  const sourceSystem = payload.channel === "google_sheets" && payload.sourceSystem?.startsWith("sheets:") ? payload.sourceSystem : "archivo";
  const importId = crypto.randomUUID();
  const { error: importError } = await supabase.from("data_imports").insert({
    id: importId,
    business_id: businessId,
    kind,
    file_name: payload.fileName.slice(0, 200),
    file_hash: payload.fileHash.slice(0, 200),
    rows_total: staged.length,
    channel: payload.channel,
    source_system: sourceSystem,
    source_id: payload.sourceId ?? null,
    status: "preparada",
  });
  if (importError) return { ok: false, message: importError.message };
  const { data, error } = await supabase.rpc("preparar_lote", { p_import: importId, p_rows: staged });
  if (error) return { ok: false, message: `No se pudo preparar: ${error.message}` };
  const c = (data ?? {}) as Record<string, number>;
  return { ok: true, message: "", importId, counts: { nueva: c.nueva ?? 0, duplicada: c.duplicada ?? 0, dudosa: c.dudosa ?? 0 } };
}

/** Paso 2: aplica las filas nuevas. Las dudosas quedan para revisar; las duplicadas se omiten. */
export async function applyImport(businessId: string, importId: string, kind: ImportKind): Promise<ImportResult> {
  const { supabase } = await context(businessId);
  const { data, error } = await supabase.rpc("aplicar_lote", { p_import: importId });
  if (error) return { ok: false, message: `No se importó nada: ${error.message}` };
  revalidatePath(`/negocio/${businessId}`, "layout");
  const r = data as { aplicadas: number; duplicadas: number; para_revisar: number };
  const parts = [`Listo: se importaron ${r.aplicadas} ${NOUN[kind]}`];
  if (r.duplicadas) parts.push(`${r.duplicadas} ya estaban y no se duplicaron`);
  if (r.para_revisar) parts.push(`${r.para_revisar} para revisar`);
  return { ok: true, message: `${parts.join(" · ")}.` };
}

/** Decisión sobre una coincidencia dudosa. */
export async function decideRow(businessId: string, rowId: string, decision: "importar" | "vincular" | "descartar"): Promise<void> {
  const { supabase } = await context(businessId);
  const { error } = await supabase.rpc("decidir_fila", { p_row: rowId, p_decision: decision });
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}

/** Descarga una planilla de Google compartida con "cualquiera con el link", como CSV. */
async function downloadSheet(link: string): Promise<{ rows: string[][]; sourceSystem: string } | string> {
  const target = googleSheetCsvUrl(link);
  if (!target) return "Pegá el link de una planilla de Google (docs.google.com/spreadsheets/…)";
  let url = target.url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("location") ?? "", url);
      // Google entrega el CSV desde sus propios dominios; a otros no se sigue.
      if (next.protocol !== "https:" || !(next.hostname === "docs.google.com" || next.hostname.endsWith(".googleusercontent.com"))) {
        return "La planilla redirige a un sitio inesperado";
      }
      url = next.toString();
      continue;
    }
    if (!res.ok) return "No se pudo abrir la planilla: compartila como «Cualquier persona con el vínculo puede ver»";
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      return "La planilla no es pública: compartila como «Cualquier persona con el vínculo puede ver»";
    }
    const text = await res.text();
    if (text.length > MAX_SHEET_BYTES) return "La planilla es demasiado grande (máximo 5 MB)";
    return { rows: Papa.parse<string[]>(text, { skipEmptyLines: false }).data, sourceSystem: target.sourceSystem };
  }
  return "La planilla redirige demasiadas veces";
}

export async function fetchGoogleSheet(businessId: string, link: string): Promise<{ ok: boolean; message: string; rows?: string[][]; sourceSystem?: string }> {
  await context(businessId);
  const result = await downloadSheet(link);
  if (typeof result === "string") return { ok: false, message: result };
  return { ok: true, message: "", ...result };
}

/** Guarda la planilla como fuente para volver a sincronizarla sin repetir la configuración. */
export async function saveSource(
  businessId: string,
  payload: { name: string; link: string; kind: ImportKind; headerRow: number; mapping: Mapping; funnelId: string | null },
): Promise<{ ok: boolean; message: string; id?: string }> {
  const { supabase } = await context(businessId);
  if (!googleSheetCsvUrl(payload.link)) return { ok: false, message: "Link inválido" };
  if (!["ventas", "consultas", "oportunidades"].includes(payload.kind)) return { ok: false, message: "Tipo inválido" };
  const { data, error } = await supabase
    .from("data_sources")
    .insert({
      business_id: businessId,
      kind: "google_sheets",
      name: payload.name.trim().slice(0, 120) || "Planilla de Google",
      data_kind: payload.kind,
      config: { url: payload.link, headerRow: payload.headerRow, funnelId: payload.funnelId },
      mapping: payload.mapping,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "", id: data.id as string };
}

/** Sincronizar ahora: trae la planilla otra vez y aplica solo lo nuevo. */
export async function syncSource(businessId: string, sourceId: string): Promise<void> {
  const { supabase, business } = await context(businessId);
  const { data: source } = await supabase.from("data_sources").select("*").eq("id", sourceId).eq("business_id", businessId).maybeSingle();
  if (!source) throw new Error("Fuente no encontrada");
  const fail = async (message: string) => {
    await supabase.from("data_sources").update({ last_error: message }).eq("id", sourceId);
    revalidatePath(`/negocio/${businessId}/importar`);
  };
  const config = source.config as { url: string; headerRow: number; funnelId: string | null };
  const sheet = await downloadSheet(config.url);
  if (typeof sheet === "string") return fail(sheet);
  const kind = source.data_kind as ImportKind;
  const mapping = source.mapping as Mapping;
  const dataRows = sheet.rows.slice(config.headerRow + 1);
  const options = {
    timezone: business.timezone,
    currency: business.currency,
    today: localDate(new Date().toISOString(), business.timezone),
    normalizePhone: (raw: string) => normalizePhone(raw, business.timezone),
  };
  const first = config.headerRow + 2;
  const parsed =
    kind === "ventas" ? parseSales(dataRows, mapping, options, first)
    : kind === "oportunidades" ? parseOpportunities(dataRows, mapping, options, first)
    : parseTallies(dataRows, mapping, options, first);
  const prepared = await prepareImport(businessId, {
    kind,
    channel: "google_sheets",
    fileName: source.name,
    fileHash: `sync:${new Date().toISOString()}`,
    sourceSystem: sheet.sourceSystem,
    sourceId,
    funnelId: config.funnelId,
    rows: parsed.rows,
  });
  if (!prepared.ok) return fail(prepared.message);
  const applied = await applyImport(businessId, prepared.importId!, kind);
  if (!applied.ok) return fail(applied.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}

export async function deleteSource(businessId: string, sourceId: string): Promise<void> {
  const { supabase } = await context(businessId);
  const { error } = await supabase.from("data_sources").update({ active: false }).eq("id", sourceId);
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}/importar`);
}

/** Quita lo que trajo una importación hecha por error. Queda registrado en la auditoría. */
export async function undoImport(businessId: string, importId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("deshacer_importacion", { p_import: importId });
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}
