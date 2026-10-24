"use server";

import { revalidatePath } from "next/cache";
import type { ImportKind, SaleImportRow, TallyImportRow } from "@/domain/import";
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

function invalidTally(r: TallyImportRow): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha) || !isInt(r.consultas);
}

export async function importData(
  businessId: string,
  payload: { kind: ImportKind; fileName: string; fileHash: string; rows: SaleImportRow[] | TallyImportRow[]; force: boolean },
): Promise<ImportResult> {
  const supabase = await createClient();
  const business = await getBusiness(supabase, businessId);
  if (!business) return { ok: false, message: "No tenés acceso a este negocio" };
  const { kind, rows } = payload;
  if (kind !== "ventas" && kind !== "consultas") return { ok: false, message: "Tipo de importación inválido" };
  if (rows.length === 0) return { ok: false, message: "No hay filas válidas para importar" };
  if (rows.length > MAX_ROWS) return { ok: false, message: `Máximo ${MAX_ROWS} filas por archivo: dividilo en partes` };
  const bad =
    kind === "ventas"
      ? (rows as SaleImportRow[]).findIndex((r) => invalidSale(r, business.currency))
      : (rows as TallyImportRow[]).findIndex(invalidTally);
  if (bad >= 0) return { ok: false, message: `La fila ${bad + 1} tiene datos inválidos` };

  if (!payload.force) {
    const { data: previous } = await supabase
      .from("data_imports")
      .select("created_at, rows_imported")
      .eq("business_id", businessId)
      .eq("file_hash", payload.fileHash)
      .gt("rows_imported", 0)
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

  const { data: count, error } = await supabase.rpc(kind === "ventas" ? "importar_ventas" : "importar_consultas", {
    p_import: importId,
    p_rows: rows,
  });
  if (error) return { ok: false, message: `No se importó nada: ${error.message}` };

  revalidatePath(`/negocio/${businessId}`, "layout");
  return { ok: true, message: `Listo: se importaron ${count} ${kind === "ventas" ? "ventas" : "días de consultas"}.` };
}
