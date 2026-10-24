-- V1B en la base: prospección, deshacer importación, fusionar contactos, marketing y acceso.
-- Datos ficticios.
\set ON_ERROR_STOP on

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
insert into public.businesses (id, name) values
  ('10000000-0000-0000-0000-0000000000d1', 'Taller Demo V1B'),
  ('10000000-0000-0000-0000-0000000000d2', 'Otro Taller Demo');
insert into public.memberships values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1'),
  ('10000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2');

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

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', false);

-- Prospección: importar, avanzar estados y convertir.
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total)
values ('60000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'prospectos', 'talleres.csv', 'p1', 3);
select public.importar_prospectos('60000000-0000-0000-0000-0000000000d1', '[
  {"nombre": "Taller Uno", "telefono": "+5491100001111", "origen": "Google Maps"},
  {"nombre": "Taller Dos", "telefono": "+5491100002222"},
  {"nombre": "Taller Uno repetido", "telefono": "+5491100001111"}
]'::jsonb);
select pg_temp.expect((select count(*) from public.prospects) = 2, 'importar prospectos saltea teléfonos repetidos');
select pg_temp.expect((select data_origin from public.prospects where name = 'Taller Dos') = 'talleres.csv',
  'sin origen se registra el archivo como procedencia');

select public.cambiar_estado_prospecto((select id from public.prospects where name = 'Taller Uno'), 'interesado');
select pg_temp.expect((select contacted_at is not null and responded_at is not null and interested_at is not null
  from public.prospects where name = 'Taller Uno'), 'interesado implica contactado y respondió');
select pg_temp.expect_error($$select public.cambiar_estado_prospecto((select id from public.prospects limit 1), 'cliente')$$,
  'cliente no se marca a mano');
select public.convertir_prospecto((select id from public.prospects where name = 'Taller Uno'), 'Compra de repuestos por mayor');
select pg_temp.expect((select o.source::text from public.prospects p join public.opportunities o on o.id = p.opportunity_id
  where p.name = 'Taller Uno') = 'prospeccion', 'convertir crea una oportunidad con origen prospección');
select pg_temp.expect_error($$select public.convertir_prospecto((select id from public.prospects where name = 'Taller Uno'), 'x')$$,
  'no se convierte dos veces');
select pg_temp.expect((select count(*) from public.outreach_events) = 2, 'cada cambio de estado queda registrado');

-- Deshacer una importación de ventas.
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total)
values ('60000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d1', 'ventas', 'ventas.xlsx', 'v1', 2);
select public.importar_ventas('60000000-0000-0000-0000-0000000000d2', '[
  {"fecha": "2026-03-01T15:00:00Z", "monto": 5000000, "cobrado": 5000000, "moneda": "ARS", "cliente": "Importado Demo"},
  {"fecha": "2026-03-02T15:00:00Z", "monto": 2000000, "cobrado": 1000000, "moneda": "ARS", "telefono": "+5491100001111"}
]'::jsonb);
select pg_temp.expect((select count(*) from public.sales) = 2, 'las ventas importadas existen');

-- El otro alumno no puede deshacer importaciones ajenas.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', false);
select pg_temp.expect_error($$select public.deshacer_importacion('60000000-0000-0000-0000-0000000000d2')$$,
  'no se deshace una importación de otro negocio');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', false);

select pg_temp.expect(public.deshacer_importacion('60000000-0000-0000-0000-0000000000d2') = 2, 'deshacer quita las 2 ventas importadas');
select pg_temp.expect((select count(*) from public.sales) = 0 and (select count(*) from public.payments) = 0,
  'sin ventas ni cobros importados');
select pg_temp.expect((select count(*) from public.contacts where name = 'Importado Demo') = 0,
  'se quita el contacto que solo existía por la importación');
select pg_temp.expect((select count(*) from public.contacts) = 1, 'se conserva el contacto que tiene otra oportunidad');
select pg_temp.expect((select count(*) from public.audit_log where table_name = 'sales' and action = 'delete') = 2,
  'lo quitado queda en la auditoría');
select pg_temp.expect_error($$select public.deshacer_importacion('60000000-0000-0000-0000-0000000000d2')$$, 'no se deshace dos veces');
select public.registrar_venta_rapida('10000000-0000-0000-0000-0000000000d1', 100000, 'ARS', 100000, 'Funda');
delete from public.sales;
select pg_temp.expect((select count(*) from public.sales) = 1, 'fuera de deshacer, una venta sigue sin poder borrarse a mano');

-- Fusionar contactos duplicados.
select public.crear_oportunidad('10000000-0000-0000-0000-0000000000d1', 'Pantalla', 'Juan Demo', '+5491133334444');
select public.crear_oportunidad('10000000-0000-0000-0000-0000000000d1', 'Batería', 'Juan D.', '+5491155556666');
select public.fusionar_contactos(
  (select contact_id from public.contact_phones where phone_e164 = '+5491133334444'),
  (select contact_id from public.contact_phones where phone_e164 = '+5491155556666'));
select pg_temp.expect((select count(distinct contact_id) from public.opportunities where need in ('Pantalla', 'Batería')) = 1,
  'las oportunidades quedan en un solo contacto');
select pg_temp.expect((select count(*) from public.contact_phones where contact_id =
  (select contact_id from public.contact_phones where phone_e164 = '+5491133334444')) = 2, 'con sus dos teléfonos');
select pg_temp.expect((select count(*) from public.contacts where merged_into is not null) = 1, 'el duplicado queda marcado, no se borra');

-- Marketing: datos de cada negocio aislados.
insert into public.content_items (id, business_id, url, published_on, angle)
values ('70000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'https://instagram.com/p/demo', '2026-10-01', 'pantalla rota');
insert into public.content_metric_snapshots (business_id, content_id, observed_on, views)
values ('10000000-0000-0000-0000-0000000000d1', '70000000-0000-0000-0000-0000000000d1', '2026-10-03', 1500);
insert into public.ad_campaigns (id, business_id, name) values ('80000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'Campaña demo');
insert into public.ad_metric_snapshots (business_id, campaign_id, period_start, period_end, spend, currency, conversations)
values ('10000000-0000-0000-0000-0000000000d1', '80000000-0000-0000-0000-0000000000d1', '2026-10-01', '2026-10-07', 5000000, 'ARS', 40);
update public.businesses set semaforo_verde = 0.9, semaforo_amarillo = 0.7 where id = '10000000-0000-0000-0000-0000000000d1';
select pg_temp.expect_error($$update public.businesses set semaforo_amarillo = 0.95 where id = '10000000-0000-0000-0000-0000000000d1'$$,
  'el umbral amarillo no supera al verde');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', false);
select pg_temp.expect((select count(*) from public.content_items) + (select count(*) from public.ad_metric_snapshots)
  + (select count(*) from public.prospects) = 0, 'el otro alumno no ve contenido, anuncios ni prospectos ajenos');
select pg_temp.expect_error($$insert into public.content_metric_snapshots (business_id, content_id, observed_on, views)
  values ('10000000-0000-0000-0000-0000000000d2', '70000000-0000-0000-0000-0000000000d1', '2026-10-03', 1)$$,
  'no se cargan métricas sobre contenido ajeno');

reset role;
\echo 'Todos los tests de la V1B pasaron'
