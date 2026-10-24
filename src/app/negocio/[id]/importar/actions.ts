"use server";

import { revalidatePath } from "next/cache";
import type { ImportKind, ProspectImportRow, SaleImportRow, TallyImportRow } from "@/domain/import";
import { getBusiness } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export type ImportResult = { ok: boolean; message: string; duplicate?: boolean };

const MAX_ROWS = 5000;
const isInt = (v: unknown, min = 0) => typeof v === "number" && Number.isInteger(v) && v >= min;
const shortText = (v: unknown) => v === null || (typeof v === "string" && v.length <= 200);

/** Revalida en el servidor lo que armó el navegador: nunca se confía en el cliente. */
function invalidSale(r: SaleImportRow, currency: string): boolean {
  return (
    Number.isNaN(Date.parse(r.fecha)) ||
    !isInt(r.monto, 1) ||
    !(r.cobrado === null || (isInt(r.cobrado) && r.cobrado <= r.monto)) ||
    !(r.costo === null || isInt(r.costo)) ||
    !(r.moneda === currency || r.moneda === "USD") ||
    !(r.telefono === null || /^\+[1-9]\d{6,14}$/.test(r.telefono)) ||
    !shortText(r.descripcion) ||
    !shortText(r.cliente)
  );
}

function invalidProspect(r: ProspectImportRow): boolean {
  return (
    !(r.telefono === null || /^\+[1-9]\d{6,14}$/.test(r.telefono)) ||
    !(r.email === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) ||
    ![r.nombre, r.empresa, r.ciudad, r.origen].every(shortText) ||
    !(r.nombre || r.empresa || r.telefono)
  );
}

function invalidTally(r: TallyImportRow): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha) || !isInt(r.consultas);
}

export async function importData(
  businessId: string,
  payload: { kind: ImportKind; fileName: string; fileHash: string; rows: SaleImportRow[] | TallyImportRow[] | ProspectImportRow[]; force: boolean },
): Promise<ImportResult> {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) return { ok: false, message: "No tenés acceso a este negocio" };
  const { kind, rows } = payload;
  if (!["ventas", "consultas", "prospectos"].includes(kind)) return { ok: false, message: "Tipo de importación inválido" };
  if (rows.length === 0) return { ok: false, message: "No hay filas válidas para importar" };
  if (rows.length > MAX_ROWS) return { ok: false, message: `Máximo ${MAX_ROWS} filas por archivo: dividilo en partes` };
  const bad =
    kind === "ventas"
      ? (rows as SaleImportRow[]).findIndex((r) => invalidSale(r, business.currency))
      : kind === "prospectos"
        ? (rows as ProspectImportRow[]).findIndex(invalidProspect)
        : (rows as TallyImportRow[]).findIndex(invalidTally);
  if (bad >= 0) return { ok: false, message: `La fila ${bad + 1} tiene datos inválidos` };

  if (!payload.force) {
    const { data: previous } = await supabase
      .from("data_imports")
      .select("created_at, rows_imported")
      .eq("business_id", businessId)
      .eq("file_hash", payload.fileHash)
      .gt("rows_imported", 0)
      .is("undone_at", null)
      .limit(1)
      .maybeSingle();
    if (previous) {
      return {
        ok: false,
        duplicate: true,
        message: `Este mismo archivo ya se importó (${previous.rows_imported} filas). Importarlo de nuevo duplicaría los datos.`,
      };
    }
  }

  const importId = crypto.randomUUID();
  const { error: importError } = await supabase.from("data_imports").insert({
    id: importId,
    business_id: businessId,
    kind,
    file_name: payload.fileName.slice(0, 200),
    file_hash: payload.fileHash,
    rows_total: rows.length,
  });
  if (importError) return { ok: false, message: importError.message };

  const rpc = { ventas: "importar_ventas", consultas: "importar_consultas", prospectos: "importar_prospectos" }[kind];
  const { data: count, error } = await supabase.rpc(rpc, {
    p_import: importId,
    p_rows: rows,
  });
  if (error) return { ok: false, message: `No se importó nada: ${error.message}` };

  revalidatePath(`/negocio/${businessId}`, "layout");
  const noun = { ventas: "ventas", consultas: "días de consultas", prospectos: "prospectos" }[kind];
  const skipped = kind === "prospectos" && count < rows.length ? ` (${rows.length - count} ya estaban cargados)` : "";
  return { ok: true, message: `Listo: se importaron ${count} ${noun}${skipped}.` };
}

/** Quita lo que trajo una importación hecha por error. Queda registrado en la auditoría. */
export async function undoImport(businessId: string, importId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("deshacer_importacion", { p_import: importId });
  if (error) throw new Error(error.message);
  revalidatePath(`/negocio/${businessId}`, "layout");
}
