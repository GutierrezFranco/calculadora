// V1B de punta a punta: proyección, semáforos, diagnóstico, canales, marketing,
// prospección, contactos, deshacer importación y alertas del mentor. Datos ficticios.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/v1b.mjs (después de flujo.mjs: usa su mentor)
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
const iso = (daysAgo, hour = 15) => new Date(Date.now() - daysAgo * 86_400_000 + (hour - 15) * 3_600_000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

// Alumno con 60 días de historia: consultas diarias, oportunidades de anuncios y orgánicas, ventas con costo.
const email = `v1b-${Date.now()}@demo.test`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password: "alumno-demo-123", email_confirm: true });
if (error) throw error;
const businessId = crypto.randomUUID();
await admin.from("businesses").insert({ id: businessId, name: "Taller Demo V1B", usd_rate: 1450 });
await admin.from("memberships").insert({ business_id: businessId, user_id: created.user.id });

const tallies = [];
for (let d = 1; d <= 60; d++) tallies.push({ business_id: businessId, date: day(d), count: 6, method: "manual" });
await admin.from("inquiry_tallies").insert(tallies);
const contact = crypto.randomUUID();
await admin.from("contacts").insert({ id: contact, business_id: businessId, name: "Cliente Histórico" });
const opps = [];
const sales = [];
for (let i = 0; i < 40; i++) {
  const id = crypto.randomUUID();
  const won = i % 2 === 0;
  opps.push({
    id, business_id: businessId, contact_id: contact, created_at: iso(2 + i), source: i % 4 === 0 ? "meta_ads" : "organico",
    stage: won ? "ganado_completado" : i % 3 === 0 ? "perdido" : "en_seguimiento",
    lost_at: !won && i % 3 === 0 ? iso(1 + i) : null, last_interaction_at: iso(1 + i),
  });
  if (won) sales.push({ business_id: businessId, opportunity_id: id, contact_id: contact, amount: 6_000_000, currency: "ARS", direct_cost: 2_000_000, won_at: iso(1 + i) });
}
const { error: oppError } = await admin.from("opportunities").insert(opps);
if (oppError) throw oppError;
await admin.from("sales").insert(sales);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const main = async () => (await page.locator("main").innerText()).replace(/\s/g, " ");
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function login(user, password, landing) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", user);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL(landing);
}
await login(email, "alumno-demo-123", /\/negocio\//);

// Marketing: campaña con inversión → costo por cliente en el dashboard.
await page.goto(`${BASE}/negocio/${businessId}/marketing?tab=anuncios`);
await page.fill("input[name=name]", "Campaña demo");
await page.click("button:has-text('Crear campaña')");
await page.getByText("Campaña creada").waitFor();
await page.reload();
await page.click("summary:has-text('Cargar inversión')");
await page.fill("input[name=from]", day(29));
await page.fill("input[name=to]", day(0));
await page.fill("input[name=spend]", "300.000");
await page.fill("input[name=conversations]", "60");
await page.click("button:has-text('Guardar')");
await page.getByText("Inversión guardada").waitFor();
await page.reload();
check((await main()).includes("$ 5.000 por conversación"), "la campaña muestra costo por conversación");

await page.goto(`${BASE}/negocio/${businessId}/marketing?tab=contenido`);
await page.fill("input[name=angle]", "Pantalla rota");
await page.fill("input[name=topic]", "Reel de pantalla");
await page.click("button:has-text('Agregar contenido')");
await page.getByText("Contenido agregado").waitFor();
await page.reload();
await page.click("summary:has-text('Cargar métricas')");
await page.fill("input[name=views]", "12.000");
await page.click("button:has-text('Guardar métricas')");
await page.getByText("Métricas guardadas").waitFor();
await page.reload();
check((await main()).includes("12.000 vistas") && (await main()).includes("no prueba que vino por ese reel"), "contenido con métricas y advertencia de atribución");

// Objetivo del mes para los semáforos.
await page.goto(`${BASE}/negocio/${businessId}/configuracion`);
const goals = page.locator("form").filter({ has: page.locator("button:has-text('Guardar objetivos')") });
await goals.locator("input[name=facturacion]").fill("100.000.000");
await goals.locator("input[name=ventas]").fill("5");
await page.click("button:has-text('Guardar objetivos')");
await page.getByText("Objetivos guardados").waitFor();

await page.goto(`${BASE}/negocio/${businessId}`);
let text = await main();
check(text.includes("Debajo de lo esperado") || text.includes("Atención") || text.includes("Muestra chica"), "semáforo en la facturación lejos del objetivo");
check(/para hacer hoy/i.test(text), "el dashboard muestra el diagnóstico");
check(text.includes("Resultados por embudo") && text.includes("Meta Ads → WhatsApp") && text.includes("Instagram orgánico"),
  "el dashboard muestra los resultados por embudo (los orígenes cargados se asignan a su embudo)");
check(/Costo por cliente\s+\$\s[\d.]+/.test(text), "costo por cliente de anuncios calculado");
await shot("v1b-dashboard");

// Proyección: supuestos reales y escenario guardado.
await page.goto(`${BASE}/negocio/${businessId}/proyeccion`);
text = await main();
check(text.includes("Real (90 días): $ 60.000"), "el ticket real sale de las ventas");
const principal = page.locator("form").filter({ has: page.locator("button:has-text('Guardar escenario principal')") });
await principal.locator("input[name=goal]").fill("3.000.000");
await page.click("button:has-text('Guardar escenario principal')");
await page.getByText("Escenario guardado").waitFor();
await page.reload();
const row = (await page.locator("tr", { hasText: "Ventas" }).first().innerText()).replace(/\s/g, " ");
check(row.includes("50"), "meta $3.000.000 / ticket $60.000 = 50 ventas");
await shot("v1b-proyeccion");

// Prospección: alta, importación con repetido, estados y conversión.
await page.goto(`${BASE}/negocio/${businessId}/prospeccion`);
await page.fill("input[name=company]", "Taller Vecino");
await page.fill("input[name=phone]", "11 7000 0001");
await page.click("button:has-text('Agregar')");
await page.getByText("Prospecto agregado").waitFor();
const dir = mkdtempSync(join(tmpdir(), "mdm-v1b-"));
const csv = join(dir, "talleres.csv");
writeFileSync(csv, "Negocio,Celular,Localidad\nTaller Norte,11 7000 0002,Quilmes\nTaller Vecino (repetido),11 7000 0001,Bernal\n");
await page.click("summary:has-text('Importar una base')");
await page.setInputFiles("input[type=file]", csv);
await page.getByText("prospectos listos para importar").waitFor();
await page.click("button:has-text('Confirmar e importar')");
await page.getByText("se importaron 1 prospectos (1 ya estaban cargados)").waitFor();
check(true, "la importación de prospectos saltea teléfonos ya cargados");
await page.reload();
const vecino = page.locator("li", { hasText: "Taller Vecino" });
await vecino.locator("select[name=status]").selectOption("interesado");
await vecino.locator("button:has-text('Guardar')").click();
await page.waitForTimeout(500);
await page.reload();
await page.locator("li", { hasText: "Taller Vecino" }).locator("input[name=need]").fill("Repuestos por mayor");
await page.locator("li", { hasText: "Taller Vecino" }).locator("button:has-text('Pasar al pipeline')").click();
await page.locator("li", { hasText: "Taller Vecino" }).getByText("ver en el pipeline").waitFor();
text = await main();
check(text.includes("Interesados") && /Oportunidades\s*1/.test(await page.locator("section").first().innerText()), "convertir suma una oportunidad de prospección");

// Contactos: el prospecto convertido y un duplicado con el mismo nombre se fusionan.
await admin.from("contacts").insert({ business_id: businessId, name: "Taller Vecino" });
await page.goto(`${BASE}/negocio/${businessId}/contactos?q=Vecino`);
const vecinos = page.locator("main li");
check((await vecinos.count()) === 2, "la búsqueda encuentra los dos 'Taller Vecino'");
await vecinos.filter({ hasText: "+541170000001" }).locator("a").click();
await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
const option = await page.locator("select[name=remove] option", { hasText: "★ Taller Vecino" }).getAttribute("value");
await page.selectOption("select[name=remove]", option);
await page.check("input[name=confirm]");
await page.click("button:has-text('Fusionar en este contacto')");
await page.getByText("Contactos fusionados").waitFor();
const { count: activeVecinos } = await admin.from("contacts").select("*", { count: "exact", head: true })
  .eq("business_id", businessId).eq("name", "Taller Vecino").is("merged_into", null);
check(activeVecinos === 1, "queda un solo contacto activo");

// Deshacer la importación de prospectos: el convertido se conserva.
await page.goto(`${BASE}/negocio/${businessId}/importar`);
await page.click("summary:has-text('Deshacer')");
await page.click("button:has-text('Confirmar: deshacer importación')");
await page.getByText("Deshecha el").waitFor();
const { data: left } = await admin.from("prospects").select("company").eq("business_id", businessId);
check(left.length === 1 && left[0].company === "Taller Vecino", "deshacer quita lo importado y conserva lo cargado a mano");

// Mentor: alertas y cambio de contraseña del alumno.
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);
await login("mentor@demo.test", "mentor-demo-123", /\/mentor$/);
text = await main();
check(text.includes("Taller Demo V1B") && text.includes("Necesitan atención"), "el panel del mentor lista al alumno y el filtro de alertas");
await shot("v1b-mentor");
const studentRow = page.locator("tr", { hasText: "Taller Demo V1B" });
await studentRow.locator("summary:has-text('Nueva contraseña')").click();
await studentRow.locator("input[name=password]").fill("clave-del-mentor-1");
await studentRow.locator("button:has-text('Cambiar')").click();
await studentRow.getByText("Contraseña cambiada").waitFor();
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);
await login(email, "clave-del-mentor-1", /\/negocio\//);
check(true, "el alumno entra con la contraseña que le puso el mentor");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/negocio/${businessId}/proyeccion`);
await shot("v1b-proyeccion-movil");

await browser.close();
console.log("Todos los pasos de la V1B pasaron");
