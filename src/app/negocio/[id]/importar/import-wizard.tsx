"use client";

import Papa from "papaparse";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  IMPORT_FIELDS,
  guessMapping,
  parseOpportunities,
  parseProspects,
  parseSales,
  parseTallies,
  type Cell,
  type ImportKind,
  type Mapping,
} from "@/domain/import";
import { formatMoney } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { applyImport, fetchGoogleSheet, importProspects, prepareImport, saveSource, type ImportResult, type Prepared } from "./actions";

interface Sheet {
  name: string;
  rows: Cell[][];
}

const KIND_NOUN: Record<ImportKind, string> = { ventas: "ventas", consultas: "días", prospectos: "prospectos", oportunidades: "consultas" };

const PREVIEW_HEADERS: Record<ImportKind, string[]> = {
  ventas: ["Fecha", "Monto", "Cobrado", "Costo", "Qué", "Cliente", "Teléfono", "ID"],
  consultas: ["Fecha", "Consultas"],
  prospectos: ["Negocio", "Contacto", "Teléfono", "Email", "Ciudad", "Origen"],
  oportunidades: ["Fecha", "Qué necesita", "Cliente", "Teléfono", "ID"],
};

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
  initialKind,
  funnels = [],
}: {
  businessId: string;
  timezone: string;
  currency: string;
  today: string;
  /** Tipo con el que arranca (la pantalla de prospección abre en "prospectos"). */
  initialKind?: ImportKind;
  /** Embudos activos, para asignar el lote entero a uno. */
  funnels?: { id: string; name: string }[];
}) {
  const [kind, setKind] = useState<ImportKind>(initialKind ?? "ventas");
  const [origin, setOrigin] = useState<"archivo" | "google_sheets">("archivo");
  const [link, setLink] = useState("");
  const [sourceSystem, setSourceSystem] = useState<string | undefined>();
  const [funnelId, setFunnelId] = useState("");
  const [keepSynced, setKeepSynced] = useState(true);
  const [sourceName, setSourceName] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
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
    if (kind === "ventas") return parseSales(dataRows, mapping, options, headerRow + 2);
    if (kind === "prospectos") return parseProspects(dataRows, mapping, options, headerRow + 2);
    if (kind === "oportunidades") return parseOpportunities(dataRows, mapping, options, headerRow + 2);
    return parseTallies(dataRows, mapping, options, headerRow + 2);
  }, [file, kind, rows, mapping, timezone, currency, today, headerRow]);

  const mapped = (id: string) => mapping[id as keyof Mapping] !== undefined && mapping[id as keyof Mapping] !== null;
  const missing: { label: string }[] = IMPORT_FIELDS[kind].filter((f) => f.required && !mapped(f.id));
  if (kind === "prospectos" && !["nombre", "empresa", "telefono"].some(mapped)) {
    missing.push({ label: "al menos nombre, negocio o teléfono" });
  }

  function load(name: string, hash: string, sheets: Sheet[]) {
    // El encabezado es la primera fila con al menos dos celdas escritas.
    const first = sheets[0]?.rows.findIndex((r) => r.filter((c) => cellText(c).trim() !== "").length >= 2) ?? 0;
    setFile({ name, hash, sheets });
    setSheetIndex(0);
    setHeaderRow(Math.max(first, 0));
    setMapping(guessMapping(sheets[0]?.rows[Math.max(first, 0)] ?? [], kind));
  }

  function reset() {
    setResult(null);
    setPrepared(null);
    setReadError(null);
    setFile(null);
  }

  async function onFile(selected: File | undefined) {
    reset();
    if (!selected) return;
    try {
      const [sheets, hash] = await Promise.all([readFile(selected), sha256(selected)]);
      setSourceSystem(undefined);
      load(selected.name, hash, sheets);
    } catch {
      setReadError("No se pudo leer el archivo. Probá guardarlo como .xlsx o .csv.");
    }
  }

  function onLink() {
    reset();
    startTransition(async () => {
      const r = await fetchGoogleSheet(businessId, link);
      if (!r.ok || !r.rows) return setReadError(r.message);
      setSourceSystem(r.sourceSystem);
      load("Planilla de Google", `sheet:${Date.now()}`, [{ name: "Hoja", rows: r.rows }]);
    });
  }

  function changeKind(next: ImportKind) {
    setKind(next);
    setResult(null);
    setPrepared(null);
    if (next === "prospectos") setOrigin("archivo");
    setMapping(guessMapping(headers, next));
  }

  async function apply(importId: string) {
    const r = await applyImport(businessId, importId, kind);
    setResult(r);
    setPrepared(null);
  }

  function submit() {
    if (!file || !parsed) return;
    startTransition(async () => {
      if (kind === "prospectos") {
        setResult(await importProspects(businessId, { fileName: file.name, fileHash: file.hash, rows: parsed.rows as ReturnType<typeof parseProspects>["rows"] }));
        return;
      }
      let sourceId: string | null = null;
      if (origin === "google_sheets" && keepSynced) {
        const saved = await saveSource(businessId, { name: sourceName || "Planilla de Google", link, kind, headerRow, mapping, funnelId: funnelId || null });
        if (!saved.ok) return setResult({ ok: false, message: saved.message });
        sourceId = saved.id ?? null;
      }
      const p = await prepareImport(businessId, {
        kind,
        channel: origin,
        fileName: origin === "google_sheets" ? sourceName || "Planilla de Google" : file.name,
        fileHash: file.hash,
        sourceSystem,
        sourceId,
        funnelId: funnelId || null,
        rows: parsed.rows,
      });
      if (!p.ok) return setResult({ ok: false, message: p.message });
      // Sin duplicados ni dudas se aplica directo; si no, se muestra el resumen antes.
      if (p.counts!.duplicada === 0 && p.counts!.dudosa === 0) return apply(p.importId!);
      setPrepared(p);
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
              ["oportunidades", "Consultas una por una (desde tu CRM o sistema)"],
              ["prospectos", "Base de prospección"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === value} onChange={() => changeKind(value)} />
              {label}
            </label>
          ))}
        </div>
        {kind !== "prospectos" && (
          <div role="group" aria-label="Origen" className="mb-4 flex w-fit gap-1 rounded-full bg-soft p-1 text-sm">
            {(
              [
                ["archivo", "Excel o CSV"],
                ["google_sheets", "Google Sheets"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setOrigin(value);
                  reset();
                }}
                className={`rounded-full px-3 py-1.5 font-semibold ${origin === value ? "bg-white shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {origin === "archivo" || kind === "prospectos" ? (
          <>
            <input
              type="file"
              accept=".xlsx,.csv,.txt"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:font-semibold file:text-white"
            />
            <p className="mt-2 text-xs text-neutral-500">
              Excel (.xlsx) o CSV, por ejemplo el reporte de tu sistema de gestión. El archivo se lee en tu navegador; solo se
              guardan las filas que confirmes. Si importás reportes que se superponen, lo que ya estaba no se duplica.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="input flex-1"
                aria-label="Link de la planilla"
              />
              <button type="button" className="btn-primary" disabled={pending || !link} onClick={onLink}>
                {pending && !file ? "Leyendo…" : "Leer planilla"}
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Compartí la planilla como «Cualquier persona con el vínculo puede ver» y pegá el link (de la hoja que querés). No se
              pide acceso a tu cuenta de Google. Podés dejarla guardada para sincronizar con un toque.
            </p>
          </>
        )}
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
              Sin columna de moneda, todo se toma en {currency}. Montos con &ldquo;US$&rdquo; se toman en dólares. Las ventas
              importadas entran como ventas directas; si coinciden con una consulta abierta del mismo cliente, te lo vamos a
              preguntar.
            </p>
          )}
          {(kind === "ventas" || kind === "oportunidades") && (
            <label className="mt-4 flex flex-col gap-1 text-sm sm:max-w-sm">
              ¿De qué embudo son? (para todo el archivo)
              <select value={funnelId} onChange={(e) => setFunnelId(e.target.value)} className="input">
                <option value="">No sé (Sin atribuir)</option>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {origin === "google_sheets" && kind !== "prospectos" && (
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={keepSynced} onChange={(e) => setKeepSynced(e.target.checked)} /> Guardar esta planilla
                para sincronizar después
              </label>
              {keepSynced && (
                <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Nombre (ej.: Planilla de ventas)" className="input sm:max-w-sm" />
              )}
            </div>
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
                <strong>{parsed.rows.length}</strong> {KIND_NOUN[kind]} {kind === "prospectos" ? "listos" : "listas"} para importar
                {total && Object.keys(total).length > 0 && <> por {formatMoney(total)}</>}
                {parsed.errors.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-red-600">
                      {parsed.errors.length === 1 ? "1 fila con error (no se importa)" : `${parsed.errors.length} filas con errores (no se importan)`}
                    </span>
                  </>
                )}
                {parsed.skipped > 0 && <span className="text-neutral-500"> · {parsed.skipped} filas vacías</span>}
              </p>

              <div className="mb-4 overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
                <table className="w-full whitespace-nowrap text-xs">
                  <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
                    <tr>
                      {PREVIEW_HEADERS[kind].map((h) => (
                        <th key={h} className="px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
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
                            <td className="px-2 py-1">{r.externalId ?? "—"}</td>
                          </>
                        ) : "necesidad" in r ? (
                          <>
                            <td className="px-2 py-1">{r.fecha.slice(0, 10)}</td>
                            <td className="px-2 py-1">{r.necesidad ?? "—"}</td>
                            <td className="px-2 py-1">{r.cliente ?? "—"}</td>
                            <td className="px-2 py-1">{r.telefono ?? "—"}</td>
                            <td className="px-2 py-1">{r.externalId ?? "—"}</td>
                          </>
                        ) : "consultas" in r ? (
                          <>
                            <td className="px-2 py-1">{r.fecha}</td>
                            <td className="px-2 py-1">{r.consultas}</td>
                          </>
                        ) : (
                          <>
                            {[r.empresa, r.nombre, r.telefono, r.email, r.ciudad, r.origen].map((v, j) => (
                              <td key={j} className="px-2 py-1">
                                {v ?? "—"}
                              </td>
                            ))}
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

              {!prepared && (
                <button type="button" className="btn-primary" disabled={pending || parsed.rows.length === 0 || result?.ok} onClick={submit}>
                  {pending ? "Revisando…" : `Confirmar e importar ${parsed.rows.length}`}
                </button>
              )}
              {prepared?.counts && (
                <div className="flex flex-col gap-3 rounded-xl bg-paper p-4 text-sm">
                  <p>
                    <strong>{prepared.counts.nueva}</strong> nuevas ·{" "}
                    <strong>{prepared.counts.duplicada}</strong> ya estaban (se omiten, no se duplican) ·{" "}
                    <strong>{prepared.counts.dudosa}</strong> parecidas a algo cargado: las revisás después
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-primary" disabled={pending} onClick={() => startTransition(() => apply(prepared.importId!))}>
                      {prepared.counts.nueva > 0 ? `Importar las ${prepared.counts.nueva} nuevas` : "Listo, seguir a la revisión"}
                    </button>
                  </div>
                </div>
              )}
              {result?.ok && result.message.includes("para revisar") && (
                <Link href={`/negocio/${businessId}/importar/revisar`} className="btn-accent mt-2">
                  Revisar coincidencias
                </Link>
              )}
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
