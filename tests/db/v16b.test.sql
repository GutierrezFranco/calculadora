-- V1.6: plan canje. Equipo recibido en parte de pago y su reventa, con aislamiento por negocio.
\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a7'),('00000000-0000-0000-0000-0000000000a8');
insert into public.businesses(id,name,usd_rate) values ('10000000-0000-0000-0000-0000000000a7','Canje ficticio',1500),('10000000-0000-0000-0000-0000000000a8','Canje ajeno',1500);
insert into public.memberships values ('10000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a7'),('10000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000a8');
create or replace function pg_temp.expect(cond boolean,label text) returns void language plpgsql as $$begin if not coalesce(cond,false) then raise exception 'FALLÓ: %',label;end if;raise notice 'ok: %',label;end$$;
create or replace function pg_temp.expect_error(stmt text,label text) returns void language plpgsql as $$begin execute stmt;raise exception 'FALLÓ: se esperaba error: %',label;exception when others then if sqlerrm like 'FALLÓ:%' then raise;end if;raise notice 'ok: %',label;end$$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a7"}',false);
\set B '''10000000-0000-0000-0000-0000000000a7'''
-- Vende un 16 Pro Max a US$ 1.000: le pagan US$ 400 en efectivo y un 15 Pro Max tomado en US$ 600.
insert into ids select 'venta', public.guardar_operacion(:B, jsonb_build_object(
  'request_id', gen_random_uuid(), 'name', 'Cliente Canje', 'kind', 'venta', 'description', 'iPhone 16 Pro Max',
  'commercial_status', 'ganada', 'work_status', 'entregado', 'agreed_amount', 100000, 'direct_cost', 78000, 'paid', 40000,
  'currency', 'USD', 'occurred_at', now()));
select pg_temp.expect_error(format($s$select public.registrar_canje('10000000-0000-0000-0000-0000000000a7',%L,'iPhone 15 Pro Max',70000)$s$,(select v from ids where k='venta')),
  'lo cobrado más el equipo no supera el precio');
insert into ids select 'canje', public.registrar_canje(:B, (select v from ids where k='venta'), 'iPhone 15 Pro Max', 60000);
select pg_temp.expect((select sum(amount) from public.payments where operation_id=(select v from ids where k='venta'))=100000,
  'la venta queda cobrada completa: US$ 400 en efectivo + US$ 600 en equipo');
select pg_temp.expect((select method from public.payments p join public.trade_ins t on t.payment_id=p.id where t.id=(select v from ids where k='canje'))='canje',
  'el equipo es un cobro en especie, distinguible del efectivo');
select pg_temp.expect((select agreed_amount from public.operations where id=(select v from ids where k='venta'))=100000, 'el precio de la venta no cambia');
-- Revende el 15 Pro Max a US$ 700: su costo es lo que valía al tomarlo.
insert into ids select 'reventa', public.guardar_operacion(:B, jsonb_build_object(
  'request_id', gen_random_uuid(), 'name', 'Otro Cliente', 'kind', 'venta', 'description', 'iPhone 15 Pro Max (canje)',
  'commercial_status', 'ganada', 'work_status', 'entregado', 'agreed_amount', 70000, 'paid', 70000,
  'currency', 'USD', 'occurred_at', now()));
select public.vender_canje(:B, (select v from ids where k='canje'), (select v from ids where k='reventa'));
select pg_temp.expect((select direct_cost from public.operations where id=(select v from ids where k='reventa'))=60000
  and (select direct_cost from public.sales where operation_id=(select v from ids where k='reventa'))=60000,
  'la reventa toma como costo el valor del canje');
select pg_temp.expect_error(format($s$select public.vender_canje('10000000-0000-0000-0000-0000000000a7',%L,%L)$s$,(select v from ids where k='canje'),(select v from ids where k='reventa')),
  'un equipo de canje no se vende dos veces');
select pg_temp.expect_error($$insert into public.trade_ins(business_id,received_operation_id,payment_id,description,value,currency)
  select business_id,received_operation_id,payment_id,'x',1,'USD' from public.trade_ins limit 1$$, 'los canjes solo se crean con la función');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a8"}',false);
select pg_temp.expect((select count(*) from public.trade_ins)=0, 'el otro alumno no ve canjes ajenos');
select pg_temp.expect_error(format($s$select public.registrar_canje('10000000-0000-0000-0000-0000000000a7',%L,'x',1)$s$,(select v from ids where k='venta')),
  'no registra canjes en un negocio ajeno');
select pg_temp.expect_error(format($s$select public.registrar_canje('10000000-0000-0000-0000-0000000000a8',%L,'x',1)$s$,(select v from ids where k='venta')),
  'no usa una venta de otro negocio');
reset role;
\echo 'Todos los tests del plan canje pasaron'
