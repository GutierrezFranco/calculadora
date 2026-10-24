// Importación guiada de punta a punta con un Excel "desprolijo" generado en el momento.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/importar.mjs. Datos ficticios.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import writeExcelFile from "write-excel-file/node";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

function check(cond, label) {
  if (!cond) throw new Error(`FALLÓ: ${label}`);
  console.log(`ok: ${label}`);
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

// Planilla como las que llevan los talleres: título arriba, fechas mezcladas, una fila mala y una vacía.
const dir = mkdtempSync(join(tmpdir(), "mdm-import-"));
const xlsx = join(dir, "ventas taller.xlsx");
await writeExcelFile([
  [{ value: "Ventas del taller (planilla de ejemplo ficticia)" }],
  [],
  ["Fecha", "Cliente", "Tel", "Equipo / reparación", "Total", "Cobrado", "Costo repuesto"].map((value) => ({ value })),
  [{ value: daysAgo(10), type: Date, format: "dd/mm/yyyy" }, { value: "Ana Demo" }, { value: "11 4444 0001" }, { value: "Módulo A12" }, { value: 85000 }, { value: 85000 }, { value: 30000 }],
  [{ value: ddmmyyyy(daysAgo(9)) }, { value: "Beto Demo" }, null, { value: "Batería" }, { value: "$ 40.000" }, { value: "20.000" }, null],
  [{ value: ddmmyyyy(daysAgo(8)) }, null, null, { value: "Funda" }, { value: 8000 }, null, null],
  [{ value: ddmmyyyy(daysAgo(7)) }, { value: "Cliente exterior" }, null, { value: "Placa" }, { value: "US$ 120" }, null, null],
  [{ value: "sin fecha" }, null, null, { value: "Fila rota" }, { value: 1000 }, null, null],
  [],
]).toFile(xlsx);
const csv = join(dir, "consultas.csv");
writeFileSync(csv, `dia,mensajes\n${ddmmyyyy(daysAgo(3))},14\n${ddmmyyyy(daysAgo(2))},9\n${ddmmyyyy(daysAgo(3))},2\n`);

const email = `importar-${Date.now()}@demo.test`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password: "alumno-demo-123", email_confirm: true });
if (error) throw error;
const businessId = crypto.randomUUID();
await admin.from("businesses").insert({ id: businessId, name: "Taller Demo Importación", usd_rate: 1450 });
await admin.from("memberships").insert({ business_id: businessId, user_id: created.user.id });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(`${BASE}/login`);
await page.fill("input[name=email]", email);
await page.fill("input[name=password]", "alumno-demo-123");
await page.click("button[type=submit]");
await page.waitForURL(/\/negocio\//);

await page.goto(`${BASE}/negocio/${businessId}/importar`);
await page.setInputFiles("input[type=file]", xlsx);
await page.getByText("ventas listas para importar").waitFor();
check((await page.inputValue("input[type=number]")) === "3", "detecta que los encabezados están en la fila 3");
const summary = (await page.locator("section", { hasText: "3. Revisá" }).locator("p").first().innerText()).replace(/\s/g, " ");
check(summary.includes("4 ventas listas"), "4 ventas válidas");
check(summary.includes("1 filas con errores"), "1 fila con error, que no se importa");
check(summary.includes("$ 133.000") && summary.includes("US$"), "total por moneda, sin mezclar pesos y dólares");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/importar.png`, fullPage: true });

await page.click("button:has-text('Confirmar e importar')");
await page.getByText("se importaron 4 ventas").waitFor();
check(true, "importa las 4 ventas");

await page.reload();
await page.setInputFiles("input[type=file]", xlsx);
await page.getByText("ventas listas para importar").waitFor();
await page.click("button:has-text('Confirmar e importar')");
await page.getByText("Este mismo archivo ya se importó").waitFor();
check(await page.locator("button:has-text('Importar igual')").isVisible(), "el mismo archivo pide confirmación antes de duplicar");

await page.reload();
await page.check("input[type=radio] >> nth=1");
await page.setInputFiles("input[type=file]", csv);
await page.getByText("días listas para importar").waitFor();
await page.click("button:has-text('Confirmar e importar')");
await page.getByText("se importaron 2 días de consultas").waitFor();
check(true, "importa consultas por día desde CSV, sumando filas del mismo día");

const { data: tallies } = await admin.from("inquiry_tallies").select("count").eq("business_id", businessId).order("date");
check(tallies.map((t) => t.count).join(",") === "16,9", "consultas: 14 + 2 el mismo día = 16, y 9");
const { data: opps } = await admin.from("opportunities").select("import_id").eq("business_id", businessId);
check(opps.length === 4 && opps.every((o) => o.import_id), "las ventas quedan marcadas como importadas");

await page.goto(`${BASE}/negocio/${businessId}`);
const text = (await page.locator("main").innerText()).replace(/\s/g, " ");
check(text.includes("$ 133.000"), "el dashboard suma las ventas importadas en pesos");
check(text.includes("US$"), "y muestra aparte las de dólares");

await browser.close();
console.log("Todos los pasos de importación pasaron");
