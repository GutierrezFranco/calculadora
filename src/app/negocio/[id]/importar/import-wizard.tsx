"use client";

import Papa from "papaparse";
import { useMemo, useState, useTransition } from "react";
import {
  IMPORT_FIELDS,
  guessMapping,
  parseSales,
  parseTallies,
  type Cell,
  type ImportKind,
  type Mapping,
} from "@/domain/import";
import { formatMoney } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { importData, type ImportResult } from "./actions";

interface Sheet {
  name: string;
  rows: Cell[][];
}

async function readFile(file: File): Promise<Sheet[]> {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    return [{ name: file.name, rows: parsed.data }];
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] }));
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function cellText(cell: Cell): string {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell ?? "");
}

export function ImportWizard({
  businessId,
  timezone,
  currency,
  today,
}: {
  businessId: string;
  timezone: string;
  currency: string;
  today: string;
}) {
  const [kind, setKind] = useState<ImportKind>("ventas");
  const [file, setFile] = useState<{ name: string; hash: string; sheets: Sheet[] } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => file?.sheets[sheetIndex]?.rows ?? [], [file, sheetIndex]);
  const headers = rows[headerRow] ?? [];

  const parsed = useMemo(() => {
    if (!file) return null;
    const dataRows = rows.slice(headerRow + 1);
    const options = { timezone, currency, today, normalizePhone: (raw: string) => normalizePhone(raw, timezone) };
    return kind === "ventas"
      ? parseSales(dataRows, mapping, options, headerRow + 2)
      : parseTallies(dataRows, mapping, options, headerRow + 2);
  }, [file, kind, rows, mapping, timezone, currency, today, headerRow]);

  const missing = IMPORT_FIELDS[kind].filter((f) => f.required && (mapping[f.id] === undefined || mapping[f.id] === null));

  async function onFile(selected: File | undefined) {
    setResult(null);
    setReadError(null);
    setFile(null);
    if (!selected) return;
    try {
      const [sheets, hash] = await Promise.all([readFile(selected), sha256(selected)]);
      // El encabezado es la primera fila con al menos dos celdas escritas.
      const first = sheets[0]?.rows.findIndex((r) => r.filter((c) => cellText(c).trim() !== "").length >= 2) ?? 0;
      setFile({ name: selected.name, hash, sheets });
      setSheetIndex(0);
      setHeaderRow(Math.max(first, 0));
      setMapping(guessMapping(sheets[0]?.rows[Math.max(first, 0)] ?? [], kind));
    } catch {
      setReadError("No se pudo leer el archivo. Probá guardarlo como .xlsx o .csv.");
    }
  }

  function changeKind(next: ImportKind) {
    setKind(next);
    setResult(null);
    setMapping(guessMapping(headers, next));
  }

  function submit(force: boolean) {
    if (!file || !parsed) return;
    startTransition(async () => {
      setResult(
        await importData(businessId, { kind, fileName: file.name, fileHash: file.hash, rows: parsed.rows, force }),
      );
    });
  }

  const total = parsed && kind === "ventas"
    ? (parsed.rows as ReturnType<typeof parseSales>["rows"]).reduce<Record<string, number>>((acc, r) => {
        acc[r.moneda] = (acc[r.moneda] ?? 0) + r.monto;
        return acc;
      }, {})
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
        <h2 className="mb-3 font-medium">1. Qué vas a importar</h2>
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          {(
            [
              ["ventas", "Ventas ya cerradas (una fila por venta)"],
              ["consultas", "Consultas por día (fecha y cantidad)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === value} onChange={() => changeKind(value)} />
              {label}
            </label>
          ))}
        </div>
        <input
          type="file"
          accept=".xlsx,.csv,.txt"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-white dark:file:bg-white dark:file:text-neutral-900"
        />
        <p className="mt-2 text-xs text-neutral-500">
          Excel (.xlsx) o CSV. Si tu sistema exporta en otro formato, abrilo en Excel y guardalo como .xlsx. El archivo
          se lee en tu navegador; solo se guardan las filas que confirmes.
        </p>
        {readError && <p className="mt-2 text-sm text-red-600">{readError}</p>}
      </section>

      {file && (
        <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">2. Qué columna es cada dato</h2>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {file.sheets.length > 1 && (
              <label className="flex flex-col gap-1 text-sm">
                Hoja
                <select
                  className="input"
                  value={sheetIndex}
                  onChange={(e) => {
                    const index = Number(e.target.value);
                    setSheetIndex(index);
                    setHeaderRow(0);
                    setMapping(guessMapping(file.sheets[index].rows[0] ?? [], kind));
                  }}
                >
                  {file.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Fila de encabezados
              <input
                type="number"
                min={1}
                max={rows.length}
                value={headerRow + 1}
                onChange={(e) => {
                  const index = Math.max(Number(e.target.value) - 1, 0);
                  setHeaderRow(index);
                  setMapping(guessMapping(rows[index] ?? [], kind));
                }}
                className="input"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS[kind].map((field) => (
              <label key={field.id} className="flex flex-col gap-1 text-sm">
                {field.label}
                {field.required ? " *" : ""}
                <select
                  className="input"
                  value={mapping[field.id] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field.id]: e.target.value === "" ? null : Number(e.target.value) })}
                >
                  <option value="">— No importar —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {cellText(h) || `Columna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {kind === "ventas" && (
            <p className="mt-3 text-xs text-neutral-500">
              Sin columna de moneda, todo se toma en {currency}. Montos con &ldquo;US$&rdquo; se toman en dólares.
            </p>
          )}
        </section>
      )}

      {file && parsed && (
        <section className="rounded-lg border border-neutral-200 p-4 sm:p-6 dark:border-neutral-800">
          <h2 className="mb-3 font-medium">3. Revisá antes de importar</h2>
          {missing.length > 0 ? (
            <p className="text-sm text-red-600">Falta elegir: {missing.map((f) => f.label).join(", ")}.</p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                <strong>{parsed.rows.length}</strong> {kind === "ventas" ? "ventas" : "días"} listas para importar
                {total && Object.keys(total).length > 0 && <> por {formatMoney(total)}</>}
                {parsed.errors.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-red-600">{parsed.errors.length} filas con errores (no se importan)</span>
                  </>
                )}
                {parsed.skipped > 0 && <span className="text-neutral-500"> · {parsed.skipped} filas vacías</span>}
              </p>

              <div className="mb-4 overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
                <table className="w-full whitespace-nowrap text-xs">
                  <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
                    <tr>
                      {kind === "ventas"
                        ? ["Fecha", "Monto", "Cobrado", "Costo", "Qué", "Cliente", "Teléfono"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)
                        : ["Fecha", "Consultas"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 15).map((r, i) => (
                      <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
                        {"monto" in r ? (
                          <>
                            <td className="px-2 py-1">{r.fecha.slice(0, 10)}</td>
                            <td className="px-2 py-1">{formatMoney({ [r.moneda]: r.monto })}</td>
                            <td className="px-2 py-1">{r.cobrado === null ? "todo" : formatMoney({ [r.moneda]: r.cobrado })}</td>
                            <td className="px-2 py-1">{r.costo === null ? "—" : formatMoney({ [r.moneda]: r.costo })}</td>
                            <td className="px-2 py-1">{r.descripcion ?? "—"}</td>
                            <td className="px-2 py-1">{r.cliente ?? "—"}</td>
                            <td className="px-2 py-1">{r.telefono ?? "—"}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2 py-1">{r.fecha}</td>
                            <td className="px-2 py-1">{r.consultas}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > 15 && <p className="mb-4 text-xs text-neutral-500">Se muestran las primeras 15.</p>}

              {parsed.errors.length > 0 && (
                <details className="mb-4 text-sm">
                  <summary className="cursor-pointer text-red-600">Ver filas con errores</summary>
                  <ul className="mt-2 list-disc pl-5 text-neutral-600 dark:text-neutral-400">
                    {parsed.errors.slice(0, 50).map((e) => (
                      <li key={e.row}>
                        Fila {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button type="button" className="btn-primary" disabled={pending || parsed.rows.length === 0 || result?.ok} onClick={() => submit(false)}>
                  {pending ? "Importando…" : `Confirmar e importar ${parsed.rows.length}`}
                </button>
                {result?.duplicate && (
                  <button type="button" className="btn-secondary" disabled={pending} onClick={() => submit(true)}>
                    Importar igual
                  </button>
                )}
              </div>
              {result && (
                <p role="status" className={`mt-2 text-sm ${result.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
                  {result.message}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
