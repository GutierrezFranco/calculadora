// Solo entorno local y datos ficticios. Se puede usar un negocio de prueba precreado.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
const file = new URL('../../.env.local', import.meta.url);
const env = { ...(existsSync(file) ? Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])) : {}), ...process.env };
const BASE = env.BASE_URL ?? 'http://localhost:3000';
const local = url => ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
assert(local(BASE) && local(env.NEXT_PUBLIC_SUPABASE_URL), 'Esta prueba solo acepta servicios locales');
const suffix = Date.now();
const email = env.E2E_OPERATION_EMAIL ?? `operaciones-${suffix}@demo.test`;
const password = env.E2E_OPERATION_PASSWORD ?? 'demo-operaciones-123';
let business = env.E2E_OPERATION_BUSINESS;
if (!business) {
 const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
 const { data, error } = await admin.auth.admin.createUser({email,password,email_confirm:true}); if(error) throw error;
 await admin.from('profiles').update({is_mentor:false}).eq('id', data.user.id);
 const { data:b, error:e } = await admin.from('businesses').insert({name:`Operaciones ficticias ${suffix}`}).select('id').single(); if(e) throw e;
 business=b.id;
 const {error:m}=await admin.from('memberships').insert({business_id:business,user_id:data.user.id});if(m)throw m;
}
const api=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const {error:loginError}=await api.auth.signInWithPassword({email,password}); if(loginError)throw loginError;
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:390,height:900}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const route = path=>`${BASE}/negocio/${business}${path}`;
const checkLayout=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'Sin overflow horizontal');
try {
 await page.goto(`${BASE}/login`);await page.fill('[name=email]',email);await page.fill('[name=password]',password);await page.getByRole('button',{name:'Ingresar'}).click();await page.waitForURL(/\/negocio\//);
 await page.goto(route('/cargar'));await page.getByRole('button',{name:'+ Crear cliente',exact:true}).click();await page.fill('[name=name]',`Cliente ficticio ${suffix}`);
 await page.fill('input[name=description]','Pantalla demo');await page.selectOption('[name=commercial]','ganada');await page.fill('[name=price]','100000');
 await page.getByText('Cobros, costos y más detalles (opcional)',{exact:true}).click();await page.fill('[name=cost]','30000');
 await checkLayout();if(env.SHOTS_DIR)await page.screenshot({path:`${env.SHOTS_DIR}/operaciones-390.png`,fullPage:true});await page.getByRole('button',{name:'Guardar y cargar otra',exact:true}).click();await page.getByText('Operación guardada',{exact:true}).waitFor();
 assert.equal(await page.locator('input[name=description]').inputValue(),'');assert.equal(await page.locator('[name=price]').inputValue(),'');assert.equal(await page.locator('[name=commercial]').inputValue(),'pendiente');
 const cid=await page.locator('[name=contactId]').inputValue();assert(cid,'Se reutiliza cliente recién creado');
 // Consulta real, una vez. La segunda y tercera operación se vinculan a ella.
 const {data:q,error:qerror}=await api.from('opportunities').insert({business_id:business,contact_id:cid,need:'Dos equipos demo'}).select('id').single();
 const inquiry=q?.id;
 if(qerror)throw qerror;
 await page.reload();await page.fill('[name=name]',`Cliente ficticio ${suffix}`);await page.getByRole('list',{name:'Clientes encontrados'}).getByRole('button').first().click();
 for (const [description,price] of [['Batería demo','50000'],['Conector demo','25000']]) {
  await page.fill('input[name=description]',description);await page.fill('[name=price]',price);await page.selectOption('[name=commercial]','ganada');
  if(await page.locator('details').filter({has:page.getByText('Cobros, costos y más detalles (opcional)',{exact:true})}).getAttribute('open')===null)await page.getByText('Cobros, costos y más detalles (opcional)',{exact:true}).click();
  await page.selectOption('[name=inquiry]',inquiry);await page.getByRole('button',{name:'Guardar y cargar otra',exact:true}).click();await page.getByText('Operación guardada',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('input[name=description]').value==='');
 }
 const {data:ops,error:opsError}=await api.from('operations').select('*').eq('business_id',business).eq('contact_id',cid);if(opsError)throw opsError;
 assert.equal(ops.length,3);assert.equal(ops.filter(o=>o.opportunity_id===inquiry).length,2);assert(ops.every(o=>!o.payment_known));
 const {data:sales}=await api.from('sales').select('id').eq('business_id',business).eq('contact_id',cid);assert.equal(sales.length,3);
 await page.goto(route(`/contactos/${cid}`));await page.getByText('Pantalla demo',{exact:false}).first().waitFor();await checkLayout();
 await page.goto(route(`/operaciones/${ops[0].id}`));await page.fill('[name=brand]','Marca demo');await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByText('Operación guardada',{exact:true}).waitFor();
 const {data:edited}=await api.from('operations').select('brand').eq('id',ops[0].id).single();assert.equal(edited?.brand,'Marca demo');
 await page.goto(route(''));await page.getByText('cobro desconocido',{exact:false}).first().waitFor();await checkLayout();
 await page.setViewportSize({width:1440,height:1000});await page.goto(route('/operaciones'));await checkLayout();if(env.SHOTS_DIR)await page.screenshot({path:`${env.SHOTS_DIR}/operaciones-1440.png`,fullPage:true});
 assert.deepEqual(errors,[]);console.log('V1.4 navegador OK: cliente reutilizado, 3 operaciones, 1 consulta para 2 trabajos, cobros desconocidos, edición y 390/1440 px');
} catch(e) { if(env.SHOTS_DIR) await page.screenshot({path:`${env.SHOTS_DIR}/operaciones-error.png`,fullPage:true}); throw e; } finally {await browser.close();}
