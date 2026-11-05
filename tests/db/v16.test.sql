-- V1.6: publicidad en dólares con cotización, métricas del anuncio y contador de consultas (+1).
\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000b1'),('00000000-0000-0000-0000-0000000000b2');
insert into public.businesses(id,name,usd_rate) values ('10000000-0000-0000-0000-0000000000b1','V16 ficticio',1500),('10000000-0000-0000-0000-0000000000b2','V16 ajeno',1500);
insert into public.memberships values ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1'),('10000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2');
create or replace function pg_temp.expect(cond boolean,label text) returns void language plpgsql as $$begin if not coalesce(cond,false) then raise exception 'FALLÓ: %',label;end if;raise notice 'ok: %',label;end$$;
create or replace function pg_temp.expect_error(stmt text,label text) returns void language plpgsql as $$begin execute stmt;raise exception 'FALLÓ: se esperaba error: %',label;exception when others then if sqlerrm like 'FALLÓ:%' then raise;end if;raise notice 'ok: %',label;end$$;
create temp table v16 (f uuid);
grant all on v16 to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1"}',false);
insert into v16 select public.crear_embudo('10000000-0000-0000-0000-0000000000b1','tiktok_live');
select pg_temp.expect(public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',(select f from v16),'2026-11-01')=1,'el primer +1 crea el mes con 1 consulta');
select public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',(select f from v16),'2026-11-01');
select public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',(select f from v16),'2026-11-01');
select pg_temp.expect(public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',(select f from v16),'2026-11-01',-1)=2,'−1 corrige un toque de más');
select pg_temp.expect((select spend is null from public.funnel_months where funnel_id=(select f from v16)),'sumar consultas no inventa inversión');
select pg_temp.expect_error(format($s$select public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',%L,'2026-11-01',5)$s$,(select f from v16)),'solo de a una');
update public.funnel_months set spend=4500,currency='USD',usd_rate=1560,followers=26,plays_3s=520,impressions=1000 where funnel_id=(select f from v16);
select pg_temp.expect((select currency='USD' and usd_rate=1560 from public.funnel_months where funnel_id=(select f from v16)),'la inversión en dólares guarda su cotización');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2"}',false);
select pg_temp.expect_error(format($s$select public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b1',%L,'2026-11-01')$s$,(select f from v16)),'no suma consultas en un negocio ajeno');
select pg_temp.expect_error(format($s$select public.sumar_consulta_embudo('10000000-0000-0000-0000-0000000000b2',%L,'2026-11-01')$s$,(select f from v16)),'no usa un embudo de otro negocio');
reset role;
\echo 'Todos los tests de la V1.6 pasaron'
