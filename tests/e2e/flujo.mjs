// Prueba de punta a punta contra Supabase local (`npx supabase start`) y la app en marcha.
// Uso: BASE_URL=http://localhost:3000 node tests/e2e/flujo.mjs
// Datos ficticios. Requiere una base recién reseteada (`npx supabase db reset`).
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

// Mentor inicial, como lo haría Franco desde el panel de Supabase.
const { data: mentor, error } = await admin.auth.admin.createUser({
  email: "mentor@demo.test", password: "mentor-demo-123", email_confirm: true,
});
if (error) throw error;
await admin.from("profiles").update({ is_mentor: true }).eq("id", mentor.user.id);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function login(email, password, landing) {
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL(landing);
}

// Sin sesión, todo manda al login.
await page.goto(`${BASE}/mentor`);
check(page.url().endsWith("/login"), "sin sesión redirige al login");

await page.fill("input[name=email]", "mentor@demo.test");
await page.fill("input[name=password]", "incorrecta");
await page.click("button[type=submit]");
await page.getByText("Email o contraseña incorrectos").waitFor();
check(true, "contraseña incorrecta muestra error");

await login("mentor@demo.test", "mentor-demo-123", /\/mentor$/);
check(true, "el mentor entra a su panel");

for (const [name, email, business] of [
  ["Alumna Demo", "alumna@demo.test", "Taller Demo Uno"],
  ["Alumno Demo", "alumno@demo.test", "Taller Demo Dos"],
]) {
  await page.fill("input[name=fullName]", name);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", "alumno-demo-123");
  await page.fill("input[name=businessName]", business);
  await page.fill("input[name=usdRate]", "1.450");
  await page.click("button:has-text('Crear alumno')");
  await page.getByText(`Listo: ${email}`).waitFor();
  await page.reload();
}
check((await page.locator("tbody tr").count()) === 2, "el mentor crea dos alumnos");
await shot("mentor");

const otherId = (await page.locator("a:has-text('Taller Demo Dos')").getAttribute("href")).split("/").pop();
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);

await login("alumna@demo.test", "alumno-demo-123", /\/negocio\/[0-9a-f-]+$/);
check(true, "la alumna entra directo a su negocio");
const ownId = page.url().split("/").pop();
await page.getByText("Sin datos").first().waitFor();
check(true, "negocio nuevo muestra Sin datos, no ceros");

await page.goto(`${BASE}/negocio/${ownId}/cargar`);
await page.fill("input[name=count]", "12");
await page.click("button:has-text('Guardar consultas')");
await page.getByText("Guardado: 12 consultas").waitFor();
await page.fill("input[name=description]", "Cambio de módulo");
await page.fill("input[name=amount]", "100.000");
await page.fill("input[name=paid]", "50.000");
await page.fill("input[name=cost]", "35.000");
await page.fill("input[name=phone]", "11 2345 6789");
await page.click("button:has-text('Registrar venta')");
await page.getByText("Venta registrada").waitFor();
await shot("cargar");

await page.goto(`${BASE}/negocio/${ownId}`);
const text = (await page.locator("main").innerText()).replace(/\s/g, " ");
check(text.includes("12"), "el dashboard muestra las consultas cargadas");
check(text.includes("$ 100.000"), "facturación pactada $100.000");
check(text.includes("$ 50.000"), "cobrado $50.000 y saldo $50.000");
check(text.includes("$ 65.000"), "contribución $65.000");
await shot("dashboard");

const res = await page.goto(`${BASE}/negocio/${otherId}`);
check(res.status() === 404, "la alumna no puede abrir el negocio del otro alumno");

await page.goto(`${BASE}/negocio/${ownId}/configuracion`);
await page.fill("input[name=usdRate]", "1.500");
await page.click("button:has-text('Guardar')");
await page.getByText("Configuración guardada").waitFor();
const { data: biz } = await admin.from("businesses").select("usd_rate").eq("id", ownId).single();
check(Number(biz.usd_rate) === 1500, "la cotización se actualiza");
const { data: sale } = await admin.from("sales").select("usd_rate").eq("business_id", ownId).single();
check(Number(sale.usd_rate) === 1450, "la venta conserva la cotización de su momento");

// El mentor desactiva a la alumna y ella pierde el acceso.
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);
await login("mentor@demo.test", "mentor-demo-123", /\/mentor$/);
await page.goto(`${BASE}/negocio/${ownId}`);
const { count: accesos } = await admin.from("mentor_access_log").select("*", { count: "exact", head: true });
check(accesos >= 1, "el acceso del mentor al negocio queda registrado");
await page.goto(`${BASE}/mentor`);
await page.locator("tr", { hasText: "Taller Demo Uno" }).locator("button").click();
await page.locator("tr", { hasText: "Taller Demo Uno" }).getByText("Inactivo").waitFor();
await page.click("button:has-text('Salir')");
await page.waitForURL(/\/login/);
await login("alumna@demo.test", "alumno-demo-123", (url) => url.pathname === "/");
await page.getByText("no tiene un negocio activo").waitFor();
check(true, "alumna desactivada no ve su negocio");

await browser.close();
console.log("Todos los pasos de punta a punta pasaron");
