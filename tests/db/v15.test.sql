-- V1.5: publicidad por mes (un registro por embudo y mes) y aislamiento por negocio.
\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2');
insert into public.businesses(id,name) values ('10000000-0000-0000-0000-0000000000a1','V15 ficticio'),('10000000-0000-0000-0000-0000000000a2','V15 ajeno');
insert into public.memberships values ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1'),('10000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2');
create or replace function pg_temp.expect(cond boolean,label text) returns void language plpgsql as $$begin if not coalesce(cond,false) then raise exception 'FALLÓ: %',label;end if;raise notice 'ok: %',label;end$$;
create or replace function pg_temp.expect_error(stmt text,label text) returns void language plpgsql as $$begin execute stmt;raise exception 'FALLÓ: se esperaba error: %',label;exception when others then if sqlerrm like 'FALLÓ:%' then raise;end if;raise notice 'ok: %',label;end$$;
create temp table v15 (f uuid);
grant all on v15 to authenticated;
select pg_temp.expect((select name='Tráfico al perfil' from public.funnel_templates where key='meta_perfil'),'nombres simples en las plantillas');
select pg_temp.expect(exists(select 1 from public.funnel_templates where key='meta_instagram'),'plantilla de anuncios a Instagram');
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1"}',false);
insert into v15 select public.crear_embudo('10000000-0000-0000-0000-0000000000a1','meta_instagram');
insert into public.funnel_months(business_id,funnel_id,month,spend,currency,inquiries)
  select '10000000-0000-0000-0000-0000000000a1',f,'2026-10-01',5000000,'ARS',40 from v15;
select pg_temp.expect_error(format($s$insert into public.funnel_months(business_id,funnel_id,month,spend,currency,inquiries) values ('10000000-0000-0000-0000-0000000000a1',%L,'2026-10-01',1,'ARS',1)$s$,(select f from v15)),'un solo registro por embudo y mes');
insert into public.funnel_months(business_id,funnel_id,month,spend,currency,inquiries)
  select '10000000-0000-0000-0000-0000000000a1',f,'2026-10-01',6000000,'ARS',45 from v15
  on conflict (business_id,funnel_id,month) do update set spend=excluded.spend,inquiries=excluded.inquiries;
select pg_temp.expect((select count(*)=1 and max(spend)=6000000 from public.funnel_months where business_id='10000000-0000-0000-0000-0000000000a1'),'corregir el mes reemplaza, no suma');
select pg_temp.expect_error(format($s$insert into public.funnel_months(business_id,funnel_id,month,spend,currency) values ('10000000-0000-0000-0000-0000000000a1',%L,'2026-10-15',1,'ARS')$s$,(select f from v15)),'el mes empieza el día 1');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a2"}',false);
select pg_temp.expect((select count(*) from public.funnel_months where business_id='10000000-0000-0000-0000-0000000000a1')=0,'el otro alumno no ve la publicidad ajena');
select pg_temp.expect_error(format($s$insert into public.funnel_months(business_id,funnel_id,month,spend,currency) values ('10000000-0000-0000-0000-0000000000a2',%L,'2026-09-01',1,'ARS')$s$,(select f from v15)),'no carga publicidad en un embudo ajeno');
reset role;
\echo 'Todos los tests de la V1.5 pasaron'
