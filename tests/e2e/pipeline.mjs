// Pipeline de punta a punta en el navegador, contra Supabase local y la app en marcha.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/pipeline.mjs  (después de flujo.mjs o con la base reseteada)
// Datos ficticios.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

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

// Alumno de prueba con su negocio, creado directo con la clave de servicio.
const email = `pipeline-${Date.now()}@demo.test`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password: "alumno-demo-123", email_confirm: true });
if (error) throw error;
const businessId = crypto.randomUUID();
await admin.from("businesses").insert({ id: businessId, name: "Taller Demo Pipeline", usd_rate: 1450 });
await admin.from("memberships").insert({ business_id: businessId, user_id: created.user.id });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const shot = async (name, fullPage = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
const main = async () => (await page.locator("main").innerText()).replace(/\s/g, " ");
const submit = async (label) => {
  await page.click(`button:has-text('${label}')`);
};
const summary = async (label) =>
  (await page.locator("section div", { has: page.locator(`p:text-is('${label}')`) }).locator("p").nth(1).innerText()).replace(/\s/g, " ");

await page.goto(`${BASE}/login`);
await page.fill("input[name=email]", email);
await page.fill("input[name=password]", "alumno-demo-123");
await page.click("button[type=submit]");
await page.waitForURL(/\/negocio\//);

// Nueva oportunidad
await page.goto(`${BASE}/negocio/${businessId}/pipeline/nueva`);
await page.fill("input[name=need]", "Cambio de pantalla");
await page.fill("input[name=contactName]", "Cliente Demo");
await page.fill("input[name=phone]", "11 5555 0001");
await submit("Crear oportunidad");
await page.waitForURL(/\/pipeline\/[0-9a-f-]{36}$/);
const firstUrl = page.url();
check((await main()).includes("Nueva consulta"), "la oportunidad nace como Nueva consulta");

// Presupuesto y seña
const quoteForm = page.locator("section", { hasText: "Presupuesto" }).filter({ has: page.locator("button:has-text('Registrar presupuesto')") });
await quoteForm.locator("input[name=amount]").fill("100.000");
await submit("Registrar presupuesto");
await page.getByText("Presupuesto registrado").waitFor();
await page.reload();
check((await main()).includes("Presupuestado"), "el presupuesto la pasa a Presupuestado");

const depositForm = page.locator("section").filter({ has: page.locator("button:has-text('Registrar seña')") });
await depositForm.locator("input[name=amount]").fill("20.000");
await submit("Registrar seña");
await page.getByText("Cobro registrado").waitFor();
await page.reload();
check((await main()).includes("Señado"), "la seña la pasa a Señado");

// Misma persona, mismo teléfono: avisa antes de duplicar.
await page.goto(`${BASE}/negocio/${businessId}/pipeline/nueva`);
await page.fill("input[name=need]", "Batería");
await page.fill("input[name=phone]", "11 5555 0001");
await submit("Crear oportunidad");
await page.getByText("Este cliente ya tiene abierta").waitFor();
check(true, "avisa que el cliente ya tiene una oportunidad abierta");
await page.check("input[name=otherNeed]");
await submit("Crear oportunidad");
await page.waitForURL(/\/pipeline\/[0-9a-f-]{36}$/);
const secondUrl = page.url();
check(secondUrl !== firstUrl, "con 'otra necesidad' crea una segunda oportunidad");

// Ganar con anticipo, cobrar saldo y completar.
await page.goto(firstUrl);
const winForm = page.locator("section").filter({ has: page.locator("button:has-text('Marcar ganada')") });
check((await winForm.locator("input[name=amount]").inputValue()) === "100000", "ganar propone el monto del presupuesto");
await winForm.locator("input[name=paid]").fill("30.000");
await submit("Marcar ganada");
// Al ganar, la página cambia a la vista de venta ganada.
await page.locator("header p", { hasText: "Ganado / en reparación" }).waitFor();
check(true, "queda Ganado / en reparación");
check((await summary("Cobrado")).includes("50.000"), "cobrado = seña + anticipo = $50.000");
check((await summary("Saldo")).includes("50.000"), "saldo $50.000");
await shot("oportunidad");

const payForm = page.locator("section").filter({ has: page.locator("button:has-text('Registrar cobro')") });
check((await payForm.locator("input[name=amount]").inputValue()) === "50000", "el cobro propone el saldo");
await submit("Registrar cobro");
await page.getByText("Cobro registrado").waitFor();
await page.reload();
check((await summary("Saldo")).includes("$ 0"), "saldo $0 después de cobrar");
await submit("Marcar completado");
await page.locator("header p", { hasText: "Ganado / completado" }).waitFor();

await page.goto(`${BASE}/negocio/${businessId}`);
let text = await main();
check(text.includes("$ 100.000"), "dashboard: facturación $100.000 una sola vez");

// Perder y reabrir la segunda.
await page.goto(secondUrl);
const loseForm = page.locator("section").filter({ has: page.locator("button:has-text('Marcar perdida')") });
await loseForm.locator("input[name=reason]").fill("Precio");
await submit("Marcar perdida");
await page.getByText("Confirmá que el cliente no sigue").waitFor();
check(true, "perder exige confirmación");
await loseForm.locator("input[name=confirm]").check();
await submit("Marcar perdida");
await page.getByText("Motivo: Precio").waitFor();
check(true, "queda perdida con su motivo");
await submit("Reabrir");
await page.locator("header p", { hasText: "En seguimiento" }).waitFor();

await page.goto(`${BASE}/negocio/${businessId}/pipeline`);
await shot("pipeline", false);
const columns = await page.locator("main section h2").allInnerTexts();
check(columns.some((c) => c.startsWith("En seguimiento") && c.endsWith("1")), "el tablero muestra la reabierta en seguimiento");
check(columns.some((c) => c.startsWith("Ganado / completado") && c.endsWith("1")), "y la ganada en completado");

// Revertir la venta con devolución.
await page.goto(firstUrl);
const reverseForm = page.locator("section").filter({ has: page.locator("button:has-text('Revertir')") });
await reverseForm.locator("input[name=reason]").fill("Garantía: devolución total");
await reverseForm.locator("input[name=confirm]").check();
await submit("Revertir");
await page.getByText("Motivo: Venta revertida").waitFor();
await page.goto(`${BASE}/negocio/${businessId}`);
text = await main();
check(!text.includes("$ 100.000"), "dashboard: la venta revertida no suma facturación");
const { data: pays } = await admin.from("payments").select("amount, kind").eq("business_id", businessId);
const net = pays.reduce((s, p) => s + (p.kind === "devolucion" ? -p.amount : Number(p.amount)), 0);
check(net === 0 && pays.length === 6, "se devolvió todo sin borrar los cobros originales");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/negocio/${businessId}/pipeline`);
await shot("pipeline-movil", false);

await browser.close();
console.log("Todos los pasos del pipeline pasaron");
