// V1.5: carga simple de reparaciones y ventas, publicidad del mes y rentabilidad por embudo.
// Solo entorno local y datos ficticios.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const file = new URL('../../.env.local', import.meta.url);
const env = { ...(existsSync(file) ? Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {}), ...process.env };
const BASE = env.BASE_URL ?? 'http://localhost:3000';
const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
assert(local(BASE) && local(env.NEXT_PUBLIC_SUPABASE_URL), 'Esta prueba solo acepta servicios locales');

const suffix = Date.now();
const email = `carga-simple-${suffix}@demo.test`;
const password = 'demo-carga-simple-123';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
await admin.from('profiles').update({ is_mentor: false }).eq('id', created.user.id);
const { data: b, error: be } = await admin.from('businesses').insert({ name: `Taller ficticio ${suffix}`, currency: 'ARS' }).select('id').single();
if (be) throw be;
const business = b.id;
const { error: me } = await admin.from('memberships').insert({ business_id: business, user_id: created.user.id });
if (me) throw me;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const route = (path) => `${BASE}/negocio/${business}${path}`;
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Sin overflow horizontal');
const shot = async (name) => env.SHOTS_DIR && page.screenshot({ path: `${env.SHOTS_DIR}/${name}.png`, fullPage: true });
const saved = async (text) => page.getByText(text).first().waitFor();

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(/\/negocio\//);

  // 1) Reparación: cliente nuevo con WhatsApp, origen "Tráfico al perfil" (se activa solo)
  await page.goto(route('/cargar'));
  await page.fill('input[name=name]', 'Juan Ficticio');
  await page.fill('input[name=phone]', '+54 9 351 555 0001');
  await page.fill('input[name=model]', 'iPhone 11');
  await page.fill('input[name=description]', 'Cambio de módulo');
  await page.fill('input[name=cost]', '15000');
  await page.fill('input[name=paid]', '45000');
  await page.getByRole('radio', { name: 'Tráfico al perfil' }).click();
  await noOverflow();
  await shot('carga-reparacion-390');
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Juan Ficticio · Cambio de módulo');
  assert.equal(await page.locator('input[name=description]').inputValue(), '', 'el formulario queda listo para otra');

  // 2) Otra reparación del mismo cliente: se elige de las sugerencias, sin duplicarlo
  await page.fill('input[name=name]', 'Juan Fic');
  await page.getByRole('button', { name: /Juan Ficticio/ }).click();
  await page.fill('input[name=model]', 'Samsung J7');
  await page.fill('input[name=description]', 'Cambio de batería');
  await page.fill('input[name=cost]', '5000');
  await page.fill('input[name=paid]', '20000');
  await page.getByRole('radio', { name: 'Tráfico al perfil' }).click();
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Juan Ficticio · Cambio de batería');

  // 3) Venta: otro cliente, origen "Anuncios a WhatsApp"
  await page.getByRole('radio', { name: /Venta/ }).click();
  await page.fill('input[name=name]', 'Ana Ficticia');
  await page.fill('input[name=description]', 'Cargador original');
  await page.fill('input[name=cost]', '8000');
  await page.fill('input[name=price]', '20000');
  await page.fill('input[name=paid]', '20000');
  await page.getByRole('radio', { name: 'Anuncios a WhatsApp' }).click();
  await shot('carga-venta-390');
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Ana Ficticia · Cargador original');

  const { count: clients } = await admin.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', business);
  assert.equal(clients, 2, 'dos clientes, no tres');
  const { data: ops } = await admin.from('operations').select('agreed_amount, direct_cost, commercial_status, model, kind').eq('business_id', business).order('created_at');
  assert.equal(ops.length, 3);
  assert.deepEqual(ops.map((o) => [o.kind, o.commercial_status, o.agreed_amount, o.direct_cost]), [
    ['reparacion', 'ganada', 4500000, 1500000],
    ['reparacion', 'ganada', 2000000, 500000],
    ['venta', 'ganada', 2000000, 800000],
  ]);
  assert.equal(ops[0].model, 'iPhone 11');

  // 4) Publicidad del mes
  await page.goto(route('/publicidad'));
  const fs = page.locator('fieldset', { hasText: 'Tráfico al perfil' });
  await fs.locator('input[name^="spend:"]').fill('25000');
  await fs.locator('input[name^="inq:"]').fill('20');
  const wsp = page.locator('fieldset', { hasText: 'Anuncios a WhatsApp' });
  await wsp.locator('input[name^="spend:"]').fill('10000');
  await wsp.locator('input[name^="inq:"]').fill('8');
  await noOverflow();
  await shot('publicidad-390');
  await page.getByRole('button', { name: /^Guardar / }).click();
  await saved('Guardado ✓');
  // Corregir el mes reemplaza, no suma
  await page.reload();
  await page.locator('fieldset', { hasText: 'Tráfico al perfil' }).locator('input[name^="spend:"]').fill('30000');
  await page.getByRole('button', { name: /^Guardar / }).click();
  await saved('Guardado ✓');
  const { data: months } = await admin.from('funnel_months').select('spend, inquiries').eq('business_id', business);
  assert.equal(months.length, 2, 'un registro por embudo y mes');
  assert(months.some((m) => m.spend === 3000000 && m.inquiries === 20));

  // 5) Reporte: Tráfico al perfil = 1 cliente de 20 consultas, facturó 65.000, costo 20.000, invirtió 30.000 → ganancia 15.000
  await page.goto(route(''));
  const card = page.locator('article', { hasText: 'Tráfico al perfil' });
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  assert.match(text, /Invertiste \$\s?30\.000, te generó 20 consultas y cerraste 1 cliente\./);
  assert.match(text, /Tasa de cierre 5 %/);
  assert.match(text, /Costo por cliente \$\s?30\.000/);
  assert.match(text, /Ganancia ?\$\s?15\.000/);
  assert.match(text, /\+50 %/);
  const total = (await page.locator('section[aria-label="Rentabilidad por embudo"]').innerText()).replace(/\s+/g, ' ');
  assert.match(total, /Clientes 2/i);
  await noOverflow();
  await shot('reporte-390');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await shot('reporte-1440');
  assert.deepEqual(errors, []);
  console.log('Carga simple, publicidad y rentabilidad: OK');
} finally {
  await browser.close();
}
