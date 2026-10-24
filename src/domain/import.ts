// Importación de planillas: adivina qué columna es cada dato, interpreta fechas y
// montos escritos de muchas formas y separa las filas válidas de las que tienen errores.
// El alumno revisa todo antes de confirmar; nada se guarda acá.
import { instantAt } from "./dates";
import { parseAmountText } from "./money";
import type { CurrencyCode, Instant, LocalDate } from "./types";

export type ImportKind = "ventas" | "consultas" | "prospectos" | "oportunidades";

export type Cell = string | number | boolean | Date | null | undefined;

export const IMPORT_FIELDS = {
  ventas: [
    { id: "fecha", label: "Fecha", required: true },
    { id: "monto", label: "Monto de la venta", required: true },
    { id: "cobrado", label: "Cobrado (vacío = todo)", required: false },
    { id: "costo", label: "Costo directo", required: false },
    { id: "descripcion", label: "Qué se vendió", required: false },
    { id: "cliente", label: "Cliente", required: false },
    { id: "telefono", label: "Teléfono", required: false },
    { id: "moneda", label: "Moneda", required: false },
    { id: "id", label: "N° de orden o ID (evita duplicados)", required: false },
  ],
  oportunidades: [
    { id: "fecha", label: "Fecha de la consulta", required: true },
    { id: "necesidad", label: "Qué necesita", required: false },
    { id: "cliente", label: "Cliente", required: false },
    { id: "telefono", label: "Teléfono", required: false },
    { id: "id", label: "N° de orden o ID (evita duplicados)", required: false },
  ],
  consultas: [
    { id: "fecha", label: "Fecha", required: true },
    { id: "consultas", label: "Cantidad de consultas", required: true },
  ],
  prospectos: [
    { id: "empresa", label: "Negocio o empresa", required: false },
    { id: "nombre", label: "Nombre de contacto", required: false },
    { id: "telefono", label: "Teléfono", required: false },
    { id: "email", label: "Email", required: false },
    { id: "ciudad", label: "Ciudad o zona", required: false },
    { id: "origen", label: "De dónde salió el dato", required: false },
  ],
} as const;

export type FieldId = (typeof IMPORT_FIELDS)[ImportKind][number]["id"];

/** Para cada campo, el índice de columna elegido (o null si no se importa). */
export type Mapping = Partial<Record<FieldId, number | null>>;

// Orden importa: "monto cobrado" tiene que caer en cobrado antes que en monto.
const KEYWORDS: [FieldId, string[]][] = [
  ["fecha", ["fecha", "dia", "date", "fec"]],
  ["id", ["n° de orden", "nro", "numero de orden", "orden", "ticket", "comprobante"]],
  ["cobrado", ["cobrado", "pagado", "abonado", "cobro", "pago"]],
  ["costo", ["costo", "coste", "repuesto", "insumo"]],
  ["monto", ["monto", "total", "importe", "precio", "venta", "valor", "facturado"]],
  ["telefono", ["telefono", "tel", "celular", "whatsapp", "cel", "movil"]],
  ["cliente", ["cliente", "nombre", "contacto"]],
  ["necesidad", ["necesidad", "consulta", "motivo", "pedido", "falla", "equipo", "modelo", "detalle"]],
  ["descripcion", ["descripcion", "detalle", "trabajo", "reparacion", "servicio", "producto", "concepto", "equipo", "modelo", "articulo"]],
  ["moneda", ["moneda", "divisa", "currency"]],
  ["empresa", ["empresa", "negocio", "local", "comercio", "razon social", "taller"]],
  ["nombre", ["nombre", "contacto", "responsable", "dueno"]],
  ["email", ["email", "e-mail", "mail", "correo"]],
  ["ciudad", ["ciudad", "localidad", "zona", "provincia", "barrio"]],
  ["origen", ["origen", "fuente", "procedencia"]],
  ["consultas", ["consultas", "consulta", "mensajes", "leads", "cantidad", "chats"]],
];

export function normalizeHeader(text: Cell): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Propone qué columna corresponde a cada campo según los encabezados. */
export function guessMapping(headers: Cell[], kind: ImportKind): Mapping {
  const fields = new Set<FieldId>(IMPORT_FIELDS[kind].map((f) => f.id));
  const used = new Set<number>();
  const mapping: Mapping = {};
  const normalized = headers.map(normalizeHeader);
  for (const [field, words] of KEYWORDS) {
    if (!fields.has(field)) continue;
    const index = normalized.findIndex((h, i) => !used.has(i) && h !== "" && words.some((w) => h.includes(w)));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha de una celda: Date de Excel, número de serie de Excel o texto (dd/mm/aaaa, aaaa-mm-dd…). */
export function parseDateCell(cell: Cell): LocalDate | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`;
  }
  if (typeof cell === "number" && cell > 20_000 && cell < 80_000) {
    // Número de serie de Excel: días desde el 30/12/1899.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(year, +m[2], +m[1]);
  }
  return null;
}

function valid(year: number, month: number, day: number): LocalDate | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Monto en centavos. Acepta números y textos como "$ 150.000", "150000,50" o "US$ 100". */
export function parseAmountCell(cell: Cell): number | null {
  if (typeof cell === "number") return cell >= 0 ? Math.round(cell * 100) : null;
  if (typeof cell !== "string") return null;
  return parseAmountText(cell.replace(/u\$s|us\$|usd|ars|\$/gi, ""));
}

export function parseCurrencyCell(cell: Cell, local: CurrencyCode): CurrencyCode | null {
  const text = normalizeHeader(cell);
  if (!text) return local;
  if (["usd", "us$", "u$s", "dolar", "dolares", "u$d"].some((w) => text.includes(w))) return "USD";
  if (text === local.toLowerCase() || ["$", "pesos", "peso", "local"].includes(text)) return local;
  return null;
}

export interface SaleImportRow {
  /** Número de fila en la planilla, para rastrear cada dato hasta su origen. */
  row?: number;
  /** Id de la fila en el sistema de origen (columna de N° de orden), si hay. */
  externalId?: string | null;
  fecha: Instant;
  monto: number;
  cobrado: number | null;
  costo: number | null;
  descripcion: string | null;
  cliente: string | null;
  telefono: string | null;
  moneda: CurrencyCode;
}

export interface TallyImportRow {
  fecha: LocalDate;
  consultas: number;
}

export interface ParseResult<T> {
  rows: T[];
  errors: { row: number; message: string }[];
  /** Filas totalmente vacías que se saltearon (no cuentan como error). */
  skipped: number;
}

const text = (cell: Cell) => {
  const value = cell instanceof Date ? "" : String(cell ?? "").trim();
  return value === "" ? null : value;
};

export interface ParseOptions {
  timezone: string;
  currency: CurrencyCode;
  today: LocalDate;
  normalizePhone: (raw: string) => string | null;
}

/** Interpreta las filas de datos (sin el encabezado). `firstRowNumber` es el número de fila en la planilla. */
export function parseSales(data: Cell[][], mapping: Mapping, options: ParseOptions, firstRowNumber = 2): ParseResult<SaleImportRow> {
  const result: ParseResult<SaleImportRow> = { rows: [], errors: [], skipped: 0 };
  const at = (row: Cell[], field: FieldId) => (mapping[field] === undefined || mapping[field] === null ? null : row[mapping[field]!]);

  data.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    if (row.every((c) => text(c) === null && !(c instanceof Date))) {
      result.skipped++;
      return;
    }
    const fail = (message: string) => result.errors.push({ row: rowNumber, message });

    const date = parseDateCell(at(row, "fecha"));
    if (!date) return fail("fecha ilegible");
    if (date > options.today) return fail("fecha futura");
    const amount = parseAmountCell(at(row, "monto"));
    if (!amount) return fail("monto vacío o inválido");
    const paidCell = at(row, "cobrado");
    const paid = text(paidCell) === null && typeof paidCell !== "number" ? null : parseAmountCell(paidCell);
    if (paid !== null && paid > amount) return fail("cobrado mayor que el monto");
    if (text(paidCell) !== null && paid === null) return fail("cobrado inválido");
    const costCell = at(row, "costo");
    const cost = text(costCell) === null && typeof costCell !== "number" ? null : parseAmountCell(costCell);
    const rawCurrency = at(row, "moneda");
    const amountText = String(at(row, "monto") ?? "").toLowerCase();
    const currency = /u\$s|us\$|usd/.test(amountText) ? "USD" : parseCurrencyCell(rawCurrency, options.currency);
    if (!currency) return fail(`moneda desconocida "${text(rawCurrency)}"`);
    const rawPhone = text(at(row, "telefono"));
    const phone = rawPhone ? options.normalizePhone(rawPhone) : null;

    result.rows.push({
      row: rowNumber,
      externalId: text(at(row, "id")),
      fecha: instantAt(date, 12, options.timezone),
      monto: amount,
      cobrado: paid,
      costo: cost,
      descripcion: text(at(row, "descripcion")),
      cliente: text(at(row, "cliente")),
      telefono: phone,
      moneda: currency,
    });
  });
  return result;
}

export function parseTallies(data: Cell[][], mapping: Mapping, options: Pick<ParseOptions, "today">, firstRowNumber = 2): ParseResult<TallyImportRow> {
  const result: ParseResult<TallyImportRow> = { rows: [], errors: [], skipped: 0 };
  const byDate = new Map<LocalDate, number>();
  data.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    if (row.every((c) => text(c) === null && !(c instanceof Date))) {
      result.skipped++;
      return;
    }
    const date = parseDateCell(mapping.fecha === undefined || mapping.fecha === null ? null : row[mapping.fecha]);
    const raw = mapping.consultas === undefined || mapping.consultas === null ? null : row[mapping.consultas];
    const count = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (!date) return result.errors.push({ row: rowNumber, message: "fecha ilegible" });
    if (date > options.today) return result.errors.push({ row: rowNumber, message: "fecha futura" });
    if (!Number.isInteger(count) || count < 0) return result.errors.push({ row: rowNumber, message: "cantidad inválida" });
    // Si el mismo día aparece varias veces, se suman (por ejemplo, una fila por canal).
    byDate.set(date, (byDate.get(date) ?? 0) + count);
  });
  result.rows = [...byDate].map(([fecha, consultas]) => ({ fecha, consultas })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return result;
}

export interface ProspectImportRow {
  nombre: string | null;
  empresa: string | null;
  telefono: string | null;
  email: string | null;
  ciudad: string | null;
  origen: string | null;
}

/** Base de prospección: cada fila necesita al menos nombre, negocio o teléfono. Teléfonos repetidos se omiten. */
export function parseProspects(
  data: Cell[][],
  mapping: Mapping,
  options: Pick<ParseOptions, "normalizePhone">,
  firstRowNumber = 2,
): ParseResult<ProspectImportRow> {
  const result: ParseResult<ProspectImportRow> = { rows: [], errors: [], skipped: 0 };
  const at = (row: Cell[], field: FieldId) => (mapping[field] === undefined || mapping[field] === null ? null : text(row[mapping[field]!]));
  const phones = new Set<string>();
  data.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    if (row.every((c) => text(c) === null)) {
      result.skipped++;
      return;
    }
    const rawPhone = at(row, "telefono");
    const phone = rawPhone ? options.normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) return result.errors.push({ row: rowNumber, message: "teléfono inválido" });
    const email = at(row, "email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return result.errors.push({ row: rowNumber, message: "email inválido" });
    const prospect = { nombre: at(row, "nombre"), empresa: at(row, "empresa"), telefono: phone, email, ciudad: at(row, "ciudad"), origen: at(row, "origen") };
    if (!prospect.nombre && !prospect.empresa && !phone) return result.errors.push({ row: rowNumber, message: "sin nombre, negocio ni teléfono" });
    if (phone && phones.has(phone)) return result.errors.push({ row: rowNumber, message: "teléfono repetido en el archivo" });
    if (phone) phones.add(phone);
    result.rows.push(prospect);
  });
  return result;
}

export interface OpportunityImportRow {
  row?: number;
  externalId: string | null;
  fecha: Instant;
  necesidad: string | null;
  cliente: string | null;
  telefono: string | null;
}

/** Consultas individuales (por ejemplo, desde el CRM o el sistema de turnos). */
export function parseOpportunities(
  data: Cell[][],
  mapping: Mapping,
  options: ParseOptions,
  firstRowNumber = 2,
): ParseResult<OpportunityImportRow> {
  const result: ParseResult<OpportunityImportRow> = { rows: [], errors: [], skipped: 0 };
  const at = (row: Cell[], field: FieldId) => (mapping[field] === undefined || mapping[field] === null ? null : row[mapping[field]!]);
  data.forEach((row, i) => {
    const rowNumber = firstRowNumber + i;
    if (row.every((c) => text(c) === null && !(c instanceof Date))) {
      result.skipped++;
      return;
    }
    const date = parseDateCell(at(row, "fecha"));
    if (!date) return result.errors.push({ row: rowNumber, message: "fecha ilegible" });
    if (date > options.today) return result.errors.push({ row: rowNumber, message: "fecha futura" });
    const rawPhone = text(at(row, "telefono"));
    const phone = rawPhone ? options.normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) return result.errors.push({ row: rowNumber, message: "teléfono inválido" });
    const need = text(at(row, "necesidad"));
    const client = text(at(row, "cliente"));
    if (!need && !client && !phone) return result.errors.push({ row: rowNumber, message: "sin necesidad, cliente ni teléfono" });
    result.rows.push({
      row: rowNumber,
      externalId: text(at(row, "id")),
      fecha: instantAt(date, 12, options.timezone),
      necesidad: need,
      cliente: client,
      telefono: phone,
    });
  });
  return result;
}

/** Convierte el link de una planilla de Google en el link de descarga CSV de esa hoja. null si no es un link válido. */
export function googleSheetCsvUrl(link: string): { url: string; sourceSystem: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(link.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com") return null;
  const m = parsed.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m) return null;
  const gid = (parsed.hash.match(/gid=(\d+)/) ?? parsed.search.match(/gid=(\d+)/))?.[1] ?? "0";
  return {
    url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`,
    sourceSystem: `sheets:${m[1]}:${gid}`,
  };
}
