// V1.3 de punta a punta: embudos y actividad, venta directa, cancelación técnica,
// importación con deduplicación y revisión de coincidencias, y panel del mentor. Datos ficticios.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/v13.mjs (después de flujo.mjs: usa su mentor)
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
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

const email = `v13-${Date.now()}@demo.test`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password: "alumno-demo-123", email_confirm: true });
if (error) throw error;
const businessId = crypto.randomUUID();
await admin.from("businesses").insert({ id: businessId, name: "Taller Demo V13", usd_rate: 1450 });
await admin.from("memberships").insert({ business_id: businessId, user_id: created.user.id });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const main = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
async function login(user, password, landing) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", user);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL(landing);
}
const form = (button) => page.locator("form").filter({ has: page.locator(`button:has-text('${button}')`) });

await login(email, "alumno-demo-123", /\/negocio\//);

// Activar TikTok Live y cargar un live.
await page.goto(`${BASE}/negocio/${businessId}/embudos`);
await page.locator("div.card", { hasText: "TikTok Live" }).locator("button:has-text('Activar plantilla')").click();
await page.locator("article", { hasText: "TikTok Live" }).locator("a:has-text('Cargar actividad')").click();
const activity = form("Guardar");
await activity.locator("input[name='paso:lives']").fill("1");
await activity.locator("input[name='paso:horas']").fill("2");
await activity.locator("input[name='paso:espectadores_unicos']").fill("380");
await activity.locator("button:has-text('Guardar')").click();
await page.getByText("Actividad registrada").waitFor();
await page.reload();
check((await main()).includes("380 Espectadores únicos"), "el detalle del embudo muestra la actividad cargada");
await shot("v13-embudo-detalle");

// Venta directa en el live: suma facturación, no consultas ni cierre.
await page.goto(`${BASE}/negocio/${businessId}/cargar`);
await page.getByRole("button", { name: "+ Crear cliente", exact: true }).click();
await page.fill("input[name=name]", "Cliente ficticio live");
await page.fill("input[name=description]", "Funda en el live");
await page.selectOption("select[name=commercial]", "ganada");
await page.fill("input[name=price]", "15.000");
await page.selectOption("select[name=funnel]", { label: "TikTok Live" });
await page.click("button:has-text('Guardar y cargar otra')");
await page.getByText("Operación guardada").waitFor();

// Consulta por Meta: se gana y se cancela por un problema técnico.
await page.goto(`${BASE}/negocio/${businessId}/pipeline/nueva`);
await page.fill("input[name=need]", "Pantalla Moto G");
await page.fill("input[name=phone]", "11 5555 0001");
await page.selectOption("select[name=funnel]", { label: "Meta Ads → WhatsApp (activar)" });
await page.click("button:has-text('Crear oportunidad')");
await page.waitForURL(/pipeline\/[0-9a-f-]{36}$/);
check((await main()).includes("Meta Ads → WhatsApp (declarado)"), "la consulta queda en su embudo con la confianza declarada");
await form("Marcar ganada").locator("input[name=amount]").fill("100.000");
await page.click("button:has-text('Marcar ganada')");
await page.locator("header p", { hasText: "Ganado / en reparación" }).waitFor();
const cancel = form("Registrar cancelación técnica");
await cancel.locator("input[name=reason]").fill("No llegó el repuesto");
await cancel.locator("input[name=confirm]").check();
await page.click("button:has-text('Registrar cancelación técnica')");
await page.getByText("no cuenta como pérdida comercial").waitFor();
check(true, "la cancelación técnica revierte la venta sin contarla como pérdida comercial");

// Una consulta sin origen, abierta.
await page.goto(`${BASE}/negocio/${businessId}/pipeline/nueva`);
await page.fill("input[name=need]", "Batería iPhone 11");
await page.fill("input[name=phone]", "11 5555 0002");
await page.click("button:has-text('Crear oportunidad')");
await page.waitForURL(/pipeline\/[0-9a-f-]{36}$/);

await page.goto(`${BASE}/negocio/${businessId}`);
let text = await main();
check(text.includes("$ 15.000"), "facturación: solo la venta directa (la cancelada no suma)");
check(text.includes("1 ventas directas"), "las ventas directas se muestran aparte");
check(text.includes("1 cancelaciones técnicas (no cuentan)"), "la cancelación técnica no cuenta en el cierre");
check(text.includes("0 ganadas de 1 consultas del mes"), "el cierre por cohorte incluye la consulta pendiente en el denominador");
check(text.includes("TikTok Live") && text.includes("Sin atribuir"), "resultados por embudo con Sin atribuir");

// Importación desde el sistema del alumno, con N° de orden: deduplicación y revisión.
const dir = mkdtempSync(join(tmpdir(), "mdm-v13-"));
const csv = join(dir, "ventas sistema.csv");
writeFileSync(
  csv,
  `Fecha,N° de orden,Cliente,Tel,Detalle,Total\n` +
    `${ddmmyyyy(daysAgo(0))},A-1,Dani,,Vidrio templado,20000\n` +
    `${ddmmyyyy(daysAgo(0))},A-2,Eli,,Cargador,30000\n` +
    `${ddmmyyyy(daysAgo(0))},A-3,Beto,11 5555 0002,Batería iPhone 11,45000\n`,
);
await page.goto(`${BASE}/negocio/${businessId}/importar`);
await page.setInputFiles("input[type=file]", csv);
await page.getByText("ventas listas para importar").waitFor();
await page.click("button:has-text('Confirmar e importar 3')");
await page.getByText("parecidas a algo cargado").waitFor();
check(/2 nuevas · 0 ya estaban/.test(await main()), "detecta 2 ventas nuevas y 1 parecida a una consulta abierta");
await page.click("button:has-text('Importar las 2 nuevas')");
await page.getByText("se importaron 2 ventas · 1 para revisar").waitFor();
await page.click("a:has-text('Revisar coincidencias')");
await page.getByText("¿es la venta de esa consulta?").waitFor();
await shot("v13-revisar");
await page.click("button:has-text('Es la venta de esa consulta')");
await page.getByText("No hay nada para revisar").waitFor();
const { data: battery } = await admin.from("opportunities").select("stage").eq("business_id", businessId).eq("need", "Batería iPhone 11").single();
check(battery.stage === "ganado_completado", "vincular la venta gana la consulta abierta: cuenta para el cierre");

await page.goto(`${BASE}/negocio/${businessId}/importar`);
await page.setInputFiles("input[type=file]", csv);
await page.getByText("ventas listas para importar").waitFor();
await page.click("button:has-text('Confirmar e importar 3')");
await page.getByText("ya estaban (se omiten").waitFor();
check(/0 nuevas · 3 ya estaban/.test(await main()), "el mismo reporte otra vez: nada se duplica");
const { count: sales } = await admin.from("sales").select("*", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "vigente");
check(sales === 4, "4 ventas vigentes: directa + 2 importadas + la de la consulta");

await page.goto(`${BASE}/negocio/${businessId}`);
text = await main();
check(text.includes("1 ganadas de 1 consultas del mes"), "el cierre sube con la consulta ganada");
await shot("v13-inicio");
await page.goto(`${BASE}/negocio/${businessId}/embudos`);
await shot("v13-embudos");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/negocio/${businessId}`);
await shot("v13-inicio-movil");
await page.setViewportSize({ width: 1360, height: 900 });

// El alumno no entra a la ficha del mentor.
await page.goto(`${BASE}/mentor/alumno/${businessId}`);
check(!page.url().includes("/mentor/alumno"), "el alumno no abre la ficha del mentor");

// Mentor: ficha, notas privadas y mes de ingreso.
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);
await login("mentor@demo.test", "mentor-demo-123", /\/mentor$/);
text = await main();
check(text.includes("Taller Demo V13") && text.includes("Cierre del programa"), "el resumen del programa lista al alumno");
await shot("v13-mentor");
await page.goto(`${BASE}/mentor/alumno/${businessId}`);
await page.fill("textarea[name=body]", "Acordamos 3 lives por semana");
await page.click("button:has-text('Guardar nota')");
await page.getByText("Nota guardada").waitFor();
const start = new Date(Date.now() - 62 * 86_400_000).toISOString().slice(0, 7);
await page.fill("input[name=month]", start);
await page.click("button:has-text('Guardar mes de ingreso')");
await page.getByText("Mes de ingreso guardado").waitFor();
await page.reload();
text = await main();
check(text.includes("Acordamos 3 lives por semana") && text.includes("Antes de MDM y ahora"), "la ficha muestra notas y la línea de base");
await shot("v13-ficha");
const { data: notes } = await admin.from("audit_log").select("id").eq("table_name", "mentor_notes");
check(notes.length === 0, "las notas no quedan en la auditoría que lee el alumno");

await browser.close();
console.log("Todos los pasos de la V1.3 pasaron");
