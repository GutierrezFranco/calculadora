-- V1.4: clientes y trabajos sin consultas ficticias, aislamiento e idempotencia.
\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1'),('00000000-0000-0000-0000-0000000000f2');
insert into public.businesses(id,name) values ('10000000-0000-0000-0000-0000000000f1','V14 ficticio'),('10000000-0000-0000-0000-0000000000f2','Ajeno ficticio');
insert into public.memberships values ('10000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f1'),('10000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f2');
create or replace function pg_temp.expect(cond boolean,label text) returns void language plpgsql as $$begin if not coalesce(cond,false) then raise exception 'FALLÓ: %',label;end if;raise notice 'ok: %',label;end$$;
create or replace function pg_temp.expect_error(stmt text,label text) returns void language plpgsql as $$begin execute stmt;raise exception 'FALLÓ: se esperaba error: %',label;exception when others then if sqlerrm like 'FALLÓ:%' then raise;end if;raise notice 'ok: %',label;end$$;
create temp table v14 (op uuid, second uuid, c uuid, inquiry uuid, payload jsonb);
grant all on v14 to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1"}',false);
insert into v14(payload) values ('{"request_id":"70000000-0000-0000-0000-0000000000f1","name":"Cliente V14","description":"Pantalla","kind":"reparacion","commercial_status":"pendiente","work_status":"entregado","currency":"ARS"}');
update v14 set op=public.guardar_operacion('10000000-0000-0000-0000-0000000000f1',payload);
update v14 set c=(select contact_id from public.operations where id=v14.op);
select pg_temp.expect((select first_contact_at is null from public.contacts where id=(select c from v14)),'sin fecha histórica no inventa primer contacto');
select pg_temp.expect((select count(*) from public.opportunities where contact_id=(select c from v14))=0,'registrar no inventa consultas');
select pg_temp.expect((select count(*) from public.sales where contact_id=(select c from v14))=0,'entregado pendiente no es venta');
select pg_temp.expect((select agreed_amount is null and direct_cost is null and not payment_known and occurred_at is null from public.operations where id=(select op from v14)),'histórico incompleto conserva desconocidos');
select pg_temp.expect(public.guardar_operacion('10000000-0000-0000-0000-0000000000f1',(select payload from v14))=(select op from v14),'doble solicitud no duplica');
update v14 set inquiry=public.crear_oportunidad('10000000-0000-0000-0000-0000000000f1','Dos equipos','Consulta demo','+5491100000099',p_created_at=>'2026-09-01T15:00:00Z');
-- El ejemplo requiere reutilizar el mismo cliente de la consulta.
update v14 set c=(select contact_id from public.opportunities where id=v14.inquiry);
update v14 set payload=jsonb_build_object('request_id','70000000-0000-0000-0000-0000000000f2','contact_id',c,'opportunity_id',inquiry,'description','Batería','kind','reparacion','commercial_status','ganada','work_status','pendiente','currency','ARS','agreed_amount',10000000,'paid',5000000,'occurred_at','2026-09-20T15:00:00Z');
update v14 set op=public.guardar_operacion('10000000-0000-0000-0000-0000000000f1',payload);
update v14 set second=public.guardar_operacion('10000000-0000-0000-0000-0000000000f1',payload||'{"request_id":"70000000-0000-0000-0000-0000000000f3","description":"Pantalla dos","paid":2000000}');
select pg_temp.expect((select count(*) from public.operations where contact_id=(select c from v14))=2,'un cliente tiene dos trabajos');
select pg_temp.expect((select count(*) from public.opportunities where contact_id=(select c from v14))=1,'una consulta para dos trabajos');
select pg_temp.expect((select count(*) from public.sales where opportunity_id=(select inquiry from v14) and status='vigente')=2,'dos ventas vigentes por consulta');
select pg_temp.expect((select count(*) from public.payments where operation_id in ((select op from v14),(select second from v14)) and paid_at is null)=2,'no inventa fecha de cobro');
select pg_temp.expect_error(format('select public.registrar_cobro(%L,100,%L)',(select inquiry from v14),'ARS'),'cobro ambiguo exige elegir trabajo');
select pg_temp.expect_error(format('select public.guardar_operacion(%L,%L::jsonb)', '10000000-0000-0000-0000-0000000000f1',(select (payload||'{"request_id":"70000000-0000-0000-0000-0000000000f4"}')::text from v14)),'coincidencia de trabajo requiere revisión');
select public.cancelar_trabajo((select id from public.sales where operation_id=(select op from v14)),'Sin repuesto',true);
select pg_temp.expect((select count(*) from public.sales where opportunity_id=(select inquiry from v14) and status='vigente')=1,'cancelar uno conserva el otro');
select pg_temp.expect((select sum(case when kind='devolucion' then -amount else amount end) from public.payments where operation_id=(select second from v14))=2000000,'no devuelve dinero del otro trabajo');
select pg_temp.expect((select lost_category is null from public.opportunities where id=(select inquiry from v14)),'la consulta parcialmente ganada no se cancela');
select pg_temp.expect_error(format('select public.guardar_operacion(%L,%L::jsonb,%L,0)','10000000-0000-0000-0000-0000000000f1',(select payload::text from v14),(select second from v14)),'versión obsoleta no pisa correcciones');
select pg_temp.expect_error(format('select public.guardar_operacion(%L,%L::jsonb)','10000000-0000-0000-0000-0000000000f2',(select payload::text from v14)),'otro negocio no acepta operaciones');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f2"}',false);
select pg_temp.expect((select count(*) from public.operations where business_id='10000000-0000-0000-0000-0000000000f1')=0,'RLS no filtra trabajos ajenos');
select pg_temp.expect_error(format('select public.guardar_operacion(%L,%L::jsonb)','10000000-0000-0000-0000-0000000000f2',(select (payload||jsonb_build_object('contact_id',c,'request_id','70000000-0000-0000-0000-0000000000f5'))::text from v14)),'no vincula contacto de otro negocio');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f1"}',false);
select pg_temp.expect_error(format('update public.sales set operation_id=%L where operation_id=%L',(select op from v14),(select second from v14)),'no reasigna ventas entre trabajos');
select pg_temp.expect_error(format('select public.guardar_operacion(%L,%L::jsonb)','10000000-0000-0000-0000-0000000000f1',(select (payload||jsonb_build_object('contact_id',null,'name','Otra persona','phone','+5491100000099','request_id','70000000-0000-0000-0000-0000000000f6'))::text from v14)),'mismo WhatsApp requiere seleccionar cliente existente');
-- La ingestión encuentra la operación manual, no vuelve a crear su venta.
insert into public.data_imports(id,business_id,kind,file_name,file_hash,rows_total,channel,source_system,status)
values('60000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000f1','ventas','ficticio.csv','v14-demo',0,'archivo','v14-demo','preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000f1',jsonb_build_array(jsonb_build_object('row',2,'data',jsonb_build_object('fecha','2026-09-20T15:00:00Z','monto',10000000,'moneda','ARS','telefono','+5491100000099','descripcion','Pantalla dos'))));
select pg_temp.expect((select status='dudosa' and match_entity='sale' from public.ingestion_rows where import_id='60000000-0000-0000-0000-0000000000f1'),'importar venta manual exige revisar coincidencia');
select public.aplicar_lote('60000000-0000-0000-0000-0000000000f1');
select pg_temp.expect((select count(*) from public.sales where contact_id=(select c from v14) and status='vigente')=1,'no duplica venta manual al aplicar lote');
insert into public.data_imports(id,business_id,kind,file_name,file_hash,rows_total,channel,source_system,status)
values('60000000-0000-0000-0000-0000000000f2','10000000-0000-0000-0000-0000000000f1','ventas','ficticio-dos.csv','v14-demo-dos',0,'archivo','v14-demo','preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000f2','[{"row":2,"data":{"fecha":"2026-09-25T15:00:00Z","monto":123456,"moneda":"ARS","descripcion":"Importada sin cobro","cliente":"Importado ficticio"}}]');
select public.aplicar_lote('60000000-0000-0000-0000-0000000000f2');
select pg_temp.expect((select not payment_known from public.operations where description='Importada sin cobro'),'importación con cobrado vacío conserva desconocido');
select pg_temp.expect(not exists(select 1 from public.payments p join public.operations o on o.id=p.operation_id where o.description='Importada sin cobro'),'importación no inventa pago total');

-- Conservar historial al fusionar: la FK diferida permite mover consulta/trabajos/ventas juntos.
select public.fusionar_contactos((select contact_id from public.operations where description='Pantalla' and business_id='10000000-0000-0000-0000-0000000000f1' limit 1),(select c from v14));
select pg_temp.expect((select count(distinct contact_id) from public.operations where opportunity_id=(select inquiry from v14))=1,'fusión conserva consulta y varios trabajos en una ficha');
reset role;
\echo 'V1.4 SQL OK'
