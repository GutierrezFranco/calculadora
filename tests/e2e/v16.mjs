// V1.6: dólares por operación, montos con vista previa, contador +1 y métricas del anuncio.
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
const email = `v16-${suffix}@demo.test`;
const password = 'demo-v16-123';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
await admin.from('profiles').update({ is_mentor: false }).eq('id', created.user.id);
const { data: b, error: be } = await admin.from('businesses').insert({ name: `Taller ficticio ${suffix}`, currency: 'ARS', usd_rate: 1500 }).select('id').single();
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

  // 1) Venta en dólares: la moneda se elige en la carga y el monto muestra cómo se entendió
  await page.goto(route('/cargar'));
  await page.getByRole('radio', { name: /Venta/ }).click();
  await page.getByRole('radio', { name: 'Dólares (US$)' }).click();
  await page.fill('input[name=name]', 'Franco Ficticio');
  await page.fill('input[name=description]', 'iPhone 16 Pro Max 256 GB');
  await page.fill('input[name=cost]', '500');
  await page.fill('input[name=price]', '680');
  await page.getByText(/= US\$\s?680/).waitFor();
  await page.fill('input[name=paid]', '680');
  await page.getByRole('radio', { name: 'Anuncios a WhatsApp' }).click();
  await noOverflow();
  await shot('v16-venta-usd-390');
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Franco Ficticio · iPhone 16 Pro Max 256 GB');
  const { data: sale } = await admin.from('operations').select('currency, agreed_amount, direct_cost').eq('business_id', business).eq('description', 'iPhone 16 Pro Max 256 GB').single();
  assert.deepEqual([sale.currency, sale.agreed_amount, sale.direct_cost], ['USD', 68000, 50000], 'la venta queda en dólares');
  // La moneda elegida para ventas se recuerda; las reparaciones siguen en pesos
  await page.getByRole('radio', { name: /Reparación/ }).click();
  assert.equal(await page.getByRole('radio', { name: 'Pesos (ARS)' }).getAttribute('aria-checked'), 'true');

  // 1b) Plan canje: vende un 16 Pro Max a US$ 1.000 con US$ 400 en plata y un 15 Pro Max tomado en US$ 600
  await page.getByRole('radio', { name: /Venta/ }).click();
  await page.fill('input[name=name]', 'Cliente Canje');
  await page.fill('input[name=description]', 'iPhone 16 Pro Max');
  await page.fill('input[name=cost]', '780');
  await page.fill('input[name=price]', '1000');
  await page.fill('input[name=paid]', '400');
  await page.getByRole('button', { name: /Recibí un equipo en parte de pago/ }).click();
  await page.fill('input[name=tradeDesc]', 'iPhone 15 Pro Max');
  await page.fill('input[name=tradeValue]', '600');
  await page.getByRole('radio', { name: 'Conocido / recomendado' }).click();
  await noOverflow();
  await shot('v16-canje-390');
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Cliente Canje · iPhone 16 Pro Max');
  const { data: trades } = await admin.from('trade_ins').select('id, value, currency, received_operation_id').eq('business_id', business);
  assert.equal(trades.length, 1, 'el equipo queda en la lista de canjes');
  const { data: pays } = await admin.from('payments').select('amount, method').eq('operation_id', trades[0].received_operation_id);
  assert.equal(pays.reduce((n, p) => n + p.amount, 0), 100000, 'la venta queda cobrada completa');
  assert(pays.some((p) => p.method === 'canje' && p.amount === 60000), 'el equipo es un cobro en especie');
  // Reventa del equipo de canje: el costo se completa solo
  await page.reload();
  await page.getByRole('radio', { name: /Venta/ }).click();
  const tradeOption = await page.locator('select[name=soldTradeIn] option', { hasText: 'iPhone 15 Pro Max' }).getAttribute('value');
  await page.selectOption('select[name=soldTradeIn]', tradeOption);
  assert.equal(await page.inputValue('input[name=description]'), 'iPhone 15 Pro Max');
  assert.equal(await page.inputValue('input[name=cost]'), '600');
  await page.fill('input[name=name]', 'Comprador Ficticio');
  await page.fill('input[name=price]', '700');
  await page.fill('input[name=paid]', '700');
  await page.getByRole('radio', { name: 'Conocido / recomendado' }).click();
  await page.getByRole('button', { name: 'Guardar y cargar otra' }).click();
  await saved('Comprador Ficticio · iPhone 15 Pro Max');
  const { data: soldTrade } = await admin.from('trade_ins').select('sold_operation_id').eq('id', trades[0].id).single();
  const { data: resale } = await admin.from('operations').select('direct_cost, agreed_amount').eq('id', soldTrade.sold_operation_id).single();
  assert.deepEqual([resale.direct_cost, resale.agreed_amount], [60000, 70000], 'la reventa tiene como costo lo que valía el canje');
  await page.locator('select[name=soldTradeIn]').waitFor({ state: 'detached' }); // sin canjes pendientes, la pregunta no aparece

  // 2) Publicidad: inversión en dólares, montos con punto y +1 durante un live
  await page.goto(route('/publicidad'));
  const wsp = page.locator('fieldset', { hasText: 'Anuncios a WhatsApp' });
  await wsp.locator('select[name^="currency:"]').selectOption('USD');
  await wsp.locator('input[name^="spend:"]').fill('22');
  await wsp.getByText(/= US\$\s?22/).waitFor();
  const inq = wsp.locator('input[name^="inq:"]');
  const valueIs = async (v) => {
    for (let t = 0; t < 50 && (await inq.inputValue()) !== v; t++) await page.waitForTimeout(100);
    assert.equal(await inq.inputValue(), v);
  };
  for (let i = 1; i <= 3; i++) {
    await wsp.getByRole('button', { name: 'Sumar una consulta' }).click();
    await valueIs(String(i));
  }
  await wsp.getByRole('button', { name: 'Restar una consulta' }).click();
  await valueIs('2'); // +1 tres veces y −1 una vez
  const perfil = page.locator('fieldset', { hasText: 'Tráfico al perfil' });
  await perfil.locator('input[name^="spend:"]').fill('70.200');
  await perfil.getByText(/= \$\s?70\.200/).waitFor();
  await perfil.locator('summary').click();
  await perfil.locator('input[name^="followers:"]').fill('40');
  await perfil.locator('input[name^="plays:"]').fill('520');
  await perfil.locator('input[name^="impressions:"]').fill('1000');
  await noOverflow();
  await shot('v16-publicidad-390');
  await page.getByRole('button', { name: /^Guardar / }).click();
  await saved('Guardado ✓');
  const { data: months } = await admin.from('funnel_months').select('spend, currency, usd_rate, inquiries, followers').eq('business_id', business);
  assert(months.some((m) => m.currency === 'USD' && m.spend === 2200 && Number(m.usd_rate) === 1500 && m.inquiries === 2), 'inversión en dólares con su cotización');
  assert(months.some((m) => m.currency === 'ARS' && m.spend === 7020000 && m.followers === 40), '70.200 se guarda como $ 70.200');

  // 3) Reporte: dólares convertidos y tráfico al perfil estimado con costo por seguidor y hook rate
  await page.goto(route(''));
  const wspCard = (await page.locator('article', { hasText: 'Anuncios a WhatsApp' }).innerText()).replace(/\s+/g, ' ');
  assert.match(wspCard, /Invertiste \$\s?33\.000/);
  assert.match(wspCard, /Facturaste \$\s?1\.020\.000/);
  const perfilCard = (await page.locator('article', { hasText: 'Tráfico al perfil' }).innerText()).replace(/\s+/g, ' ');
  assert.match(perfilCard, /Estimado/);
  assert.match(perfilCard, /Costo por seguidor \$\s?1\.755/);
  assert.match(perfilCard, /Hook rate 52 %/);
  assert.match((await page.locator('main').innerText()).replace(/\s+/g, ' '), /cotización guardada/);
  await noOverflow();
  await shot('v16-reporte-390');
  assert.deepEqual(errors, []);
  console.log('V1.6 dólares, montos, +1 y métricas del anuncio: OK');
} finally {
  await browser.close();
}
