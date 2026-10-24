-- Criterio 12: un alumno nunca accede al negocio de otro; el mentor accede a todos
-- y deja rastro. También verifica que ventas y cobros no se reescriban.
-- Datos ficticios. Se corre con scripts/test-db.sh.
\set ON_ERROR_STOP on

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- El perfil se crea solo al crear la cuenta: el primer usuario es el mentor, los siguientes no.
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000f'); -- mentor
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), -- alumna A
  ('00000000-0000-0000-0000-00000000000b'); -- alumno B
insert into public.businesses (id, name, usd_rate) values
  ('10000000-0000-0000-0000-00000000000a', 'Taller Demo A', 1450),
  ('10000000-0000-0000-0000-00000000000b', 'Taller Demo B', null);
insert into public.memberships values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b');
insert into public.contacts (id, business_id, name) values
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Cliente de B');

create function pg_temp.expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FALLÓ: se esperaba error en "%"', label;
exception when others then
  if sqlerrm like 'FALLÓ:%' then raise; end if;
  raise notice 'ok: % → %', label, sqlerrm;
end;
$$;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FALLÓ: %', label; end if;
  raise notice 'ok: %', label;
end;
$$;

select pg_temp.expect((select is_mentor from public.profiles where id = '00000000-0000-0000-0000-00000000000f'),
  'el primer usuario creado es el mentor');
select pg_temp.expect((select count(*) from public.profiles where is_mentor) = 1, 'los siguientes usuarios no son mentores');

-- ── Alumna A ──
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);

select pg_temp.expect((select count(*) from public.businesses) = 1, 'A ve solo su negocio');
select pg_temp.expect((select count(*) from public.contacts) = 0, 'A no ve contactos de B');
select pg_temp.expect_error($$insert into public.contacts (business_id, name)
  values ('10000000-0000-0000-0000-00000000000b', 'intruso')$$, 'A no puede crear en el negocio de B');
select pg_temp.expect_error($$update public.profiles set is_mentor = true
  where id = '00000000-0000-0000-0000-00000000000a'$$, 'A no puede hacerse mentora');
select pg_temp.expect_error($$update public.businesses set active = false
  where id = '10000000-0000-0000-0000-00000000000a'$$, 'A no puede desactivarse');

insert into public.contacts (id, business_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Cliente de A');
select pg_temp.expect_error($$insert into public.opportunities (business_id, contact_id)
  values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b')$$,
  'no se vincula un contacto de otro negocio');

insert into public.opportunities (id, business_id, contact_id) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a');
insert into public.sales (id, business_id, opportunity_id, contact_id, amount, currency) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 10000000, 'ARS');
update public.opportunities set stage = 'ganado_en_reparacion' where id = '30000000-0000-0000-0000-00000000000a';
insert into public.payments (id, business_id, opportunity_id, sale_id, amount, currency, kind) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 5000000, 'ARS', 'anticipo');

select pg_temp.expect((select usd_rate from public.sales) = 1450, 'la venta guarda la cotización del momento');
select pg_temp.expect_error($$update public.sales set amount = 1
  where id = '40000000-0000-0000-0000-00000000000a'$$, 'el monto pactado no se edita');
update public.payments set amount = 1 where id = '50000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select amount from public.payments) = 5000000, 'un cobro no se edita');
delete from public.payments where id = '50000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select count(*) from public.payments) = 1, 'un cobro no se borra');
select pg_temp.expect_error($$insert into public.payments (business_id, opportunity_id, amount, currency, kind, refunds_payment_id)
  values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 6000000, 'ARS', 'devolucion',
          '50000000-0000-0000-0000-00000000000a')$$, 'no se devuelve más de lo cobrado');
select pg_temp.expect_error($$insert into public.stage_history (business_id, opportunity_id, to_stage)
  values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'perdido')$$,
  'el historial de etapas no se escribe a mano');

select pg_temp.expect((select count(*) from public.stage_history) = 2, 'los cambios de etapa quedan registrados');
select pg_temp.expect((select count(*) from public.audit_log where table_name = 'sales') = 1, 'la venta queda en auditoría');

select public.registrar_venta_rapida('10000000-0000-0000-0000-00000000000a', 800000, 'ARS', 800000,
  'Cargador', 'Cliente mostrador', '+5491100000000');
select public.registrar_venta_rapida('10000000-0000-0000-0000-00000000000a', 1500000, 'ARS', 500000,
  'Vidrio', null, '+5491100000000');
select pg_temp.expect((select count(*) from public.contacts) = 2, 'la venta rápida reusa el contacto por teléfono');
select pg_temp.expect((select count(*) from public.sales) = 3, 'la venta rápida crea la venta');
select pg_temp.expect((select count(*) from public.payments where kind = 'anticipo') = 2, 'cobro parcial queda como anticipo');
select pg_temp.expect_error($$select public.registrar_venta_rapida('10000000-0000-0000-0000-00000000000b', 100, 'ARS', 100)$$,
  'A no registra ventas en el negocio de B');

-- ── Alumno B ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', false);
select pg_temp.expect((select count(*) from public.sales) = 0, 'B no ve ventas de A');
select pg_temp.expect((select count(*) from public.audit_log where business_id = '10000000-0000-0000-0000-00000000000a') = 0
  and (select count(*) from public.audit_log) > 0, 'B ve su auditoría y no la de A');
select pg_temp.expect_error($$select public.registrar_acceso_mentor('10000000-0000-0000-0000-00000000000a', 'dashboard')$$,
  'B no puede registrarse como mentor');

-- ── Mentor ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000f"}', false);
select pg_temp.expect((select count(*) from public.businesses) = 2, 'el mentor ve todos los negocios');
select public.registrar_acceso_mentor('10000000-0000-0000-0000-00000000000a', 'dashboard');
select pg_temp.expect((select count(*) from public.mentor_access_log) = 1, 'el acceso del mentor queda registrado');
update public.businesses set active = false where id = '10000000-0000-0000-0000-00000000000a';

-- ── Alumna A desactivada ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select pg_temp.expect((select count(*) from public.businesses) = 0, 'alumna desactivada pierde el acceso');

reset role;
\echo 'Todos los tests de acceso pasaron'
