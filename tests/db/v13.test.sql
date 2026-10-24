-- V1.3 en la base: embudos, atribución, ventas directas, cancelaciones técnicas,
-- ingestión con deduplicación y datos del mentor. Datos ficticios.
\set ON_ERROR_STOP on

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
insert into public.businesses (id, name) values
  ('10000000-0000-0000-0000-0000000000e1', 'Taller Demo V13'),
  ('10000000-0000-0000-0000-0000000000e2', 'Otro Taller V13');
insert into public.memberships values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1'),
  ('10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2');

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
  if not coalesce(cond, false) then raise exception 'FALLÓ: %', label; end if;
  raise notice 'ok: %', label;
end;
$$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', false);
\set B '''10000000-0000-0000-0000-0000000000e1'''

-- ── Embudos ──
select public.crear_embudo(:B, 'tiktok_live');
select pg_temp.expect((select steps -> 2 ->> 'key' from public.funnel_versions v join public.funnels f on f.id = v.funnel_id
  where f.template_key = 'tiktok_live') = 'espectadores_unicos', 'activar una plantilla copia sus pasos a la versión 1');
select pg_temp.expect((select allows_direct_sales from public.funnels where template_key = 'tiktok_live'), 'TikTok Live admite ventas directas');
select pg_temp.expect_error($$select public.crear_embudo('10000000-0000-0000-0000-0000000000e1', null, 'Mío', '[]')$$,
  'el alumno no arma embudos a medida');
select pg_temp.expect_error($$select public.versionar_embudo((select id from public.funnels where template_key = 'tiktok_live'),
  '[]', current_date + 1)$$, 'el alumno no cambia los pasos');

select public.registrar_actividad_embudo((select id from public.funnels where template_key = 'tiktok_live'), current_date,
  '{"lives": 1, "horas": 2, "espectadores_unicos": 380}', 'real', 'Live del lunes');
select pg_temp.expect_error($$select public.registrar_actividad_embudo((select id from public.funnels where template_key = 'tiktok_live'),
  current_date, '{"vistas": 10}')$$, 'no se cargan pasos que no existen en la versión');
select pg_temp.expect_error($$select public.registrar_actividad_embudo((select id from public.funnels where template_key = 'tiktok_live'),
  current_date, '{"lives": -1}')$$, 'no se cargan valores negativos');

-- ── Atribución ──
select public.crear_oportunidad(:B, 'Pantalla', 'Ana Demo', '+5491170000001', 'meta_ads', now() - interval '3 days');
select pg_temp.expect((select f.template_key from public.opportunities o join public.funnels f on f.id = o.funnel_id where o.need = 'Pantalla')
  = 'meta_whatsapp', 'una consulta con origen queda en el embudo de ese origen (se activa la plantilla)');
select pg_temp.expect((select attribution_confidence from public.opportunities where need = 'Pantalla') = 'declarada', 'con confianza declarada');
select public.crear_oportunidad(:B, 'Batería', 'Beto Demo', '+5491170000002', 'desconocido', now() - interval '2 days');
select pg_temp.expect((select funnel_id is null and attribution_confidence is null from public.opportunities where need = 'Batería'),
  'sin origen confiable queda Sin atribuir');
select public.crear_oportunidad(:B, 'Módulo', 'Caro Demo', '+5491170000003', 'desconocido', now() - interval '1 day',
  null, (select id from public.funnels where template_key = 'tiktok_live'), 'confirmada', 'Código LIVE10');
select pg_temp.expect((select source::text from public.opportunities where need = 'Módulo') = 'organico',
  'el embudo principal fija el origen histórico');

select public.agregar_punto_contacto((select id from public.opportunities where need = 'Pantalla'),
  (select id from public.funnels where template_key = 'tiktok_live'), 'Vio un live');
select pg_temp.expect_error($$select public.agregar_punto_contacto((select id from public.opportunities where need = 'Pantalla'),
  (select funnel_id from public.opportunities where need = 'Pantalla'))$$, 'el embudo principal no es también secundario');
select public.asignar_embudo((select id from public.opportunities where need = 'Pantalla'),
  (select id from public.funnels where template_key = 'tiktok_live'), 'declarada', 'Lo dijo el cliente');
select pg_temp.expect((select count(*) from public.attribution_touchpoints) = 0,
  'al pasar a principal, el punto de contacto secundario de ese embudo se quita');
select public.asignar_embudo((select id from public.opportunities where need = 'Pantalla'), null);
select pg_temp.expect((select funnel_id is null and source = 'desconocido' from public.opportunities where need = 'Pantalla'),
  'se puede volver a Sin atribuir');

-- ── Ventas directas ──
select public.registrar_venta_rapida(:B, 1500000, 'ARS', 1500000, 'Funda en el live', null, null, null, 'desconocido', now(),
  (select id from public.funnels where template_key = 'tiktok_live'));
select pg_temp.expect((select o.entry_kind from public.opportunities o where o.need = 'Funda en el live') = 'venta_directa',
  'la venta rápida es venta directa por defecto');
select public.registrar_venta_rapida(:B, 900000, 'ARS', 900000, 'Vidrio', null, null, null, 'desconocido', now(), null, false);
select pg_temp.expect((select o.entry_kind from public.opportunities o where o.need = 'Vidrio') = 'consulta',
  'si vino de una consulta, entra como consulta');

-- ── Cancelación técnica ──
select public.ganar_oportunidad((select id from public.opportunities where need = 'Módulo'), 6000000, 'ARS', 3000000);
select public.cancelar_trabajo((select s.id from public.sales s join public.opportunities o on o.id = s.opportunity_id where o.need = 'Módulo'),
  'No llegó el repuesto');
select pg_temp.expect((select s.status from public.sales s join public.opportunities o on o.id = s.opportunity_id where o.need = 'Módulo') = 'revertida',
  'la cancelación técnica revierte la venta');
select pg_temp.expect((select lost_category from public.opportunities where need = 'Módulo') = 'cancelacion_tecnica',
  'y queda como cancelación técnica, no como pérdida comercial');
select pg_temp.expect((select sum(case when kind = 'devolucion' then -amount else amount end) from public.payments p
  join public.opportunities o on o.id = p.opportunity_id where o.need = 'Módulo') = 0, 'se devuelve lo cobrado');
select pg_temp.expect_error($$select public.perder_oportunidad((select id from public.opportunities where need = 'Batería'), 'x', false, 'cancelacion_tecnica')$$,
  'perder no usa la categoría de cancelación técnica');
select public.perder_oportunidad((select id from public.opportunities where need = 'Batería'), 'Le pareció caro', false, 'precio');
select pg_temp.expect((select lost_category from public.opportunities where need = 'Batería') = 'precio', 'la pérdida comercial tiene categoría');
select public.reabrir_oportunidad((select id from public.opportunities where need = 'Batería'));
select pg_temp.expect((select lost_category is null from public.opportunities where need = 'Batería'), 'al reabrir se limpia la categoría');

-- ── Ingestión: ventas ──
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total, channel, source_system, status)
values ('60000000-0000-0000-0000-0000000000e1', :B, 'ventas', 'gestion.xlsx', 'h1', 0, 'archivo', 'archivo', 'preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000e1', jsonb_build_array(
  jsonb_build_object('row', 2, 'data', jsonb_build_object('fecha', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"15:00:00"Z"'), 'monto', 4000000, 'moneda', 'ARS', 'descripcion', 'Pantalla A10')),
  jsonb_build_object('row', 3, 'data', jsonb_build_object('fecha', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"15:00:00"Z"'), 'monto', 4000000, 'moneda', 'ARS', 'descripcion', 'Pantalla A10')),
  -- Parecida a la venta rápida "Funda en el live" (mismo monto, mismo día).
  jsonb_build_object('row', 4, 'data', jsonb_build_object('fecha', to_char(now(), 'YYYY-MM-DD"T"12:00:00"Z"'), 'monto', 1500000, 'moneda', 'ARS', 'descripcion', 'Funda')),
  -- Cliente con una consulta abierta.
  jsonb_build_object('row', 5, 'data', jsonb_build_object('fecha', to_char(now(), 'YYYY-MM-DD"T"12:00:00"Z"'), 'monto', 7000000, 'moneda', 'ARS', 'telefono', '+5491170000002', 'descripcion', 'Batería'))
));
select pg_temp.expect((select count(*) from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and status = 'nueva') = 2,
  'dos filas idénticas del mismo archivo son dos ventas nuevas');
select pg_temp.expect((select match_entity from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number = 4) = 'sale',
  'una venta parecida a otra ya cargada queda dudosa');
select pg_temp.expect((select match_entity from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number = 5) = 'opportunity',
  'una venta de un cliente con consulta abierta queda dudosa');
select public.aplicar_lote('60000000-0000-0000-0000-0000000000e1');
select pg_temp.expect((select count(*) from public.sales where description = 'Pantalla A10') = 2, 'se aplican las nuevas');
select pg_temp.expect((select rows_review from public.data_imports where id = '60000000-0000-0000-0000-0000000000e1') = 2,
  'las dudosas quedan para revisar');
select public.decidir_fila((select id from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number = 4), 'vincular');
select pg_temp.expect((select count(*) from public.sales where amount = 1500000) = 1, 'vincular con una venta existente no duplica');
select public.decidir_fila((select id from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number = 5), 'vincular');
select pg_temp.expect((select o.stage from public.opportunities o where o.need = 'Batería') = 'ganado_completado',
  'vincular con la consulta abierta la gana: la venta cuenta para el cierre de esa consulta');
select pg_temp.expect_error($$select public.decidir_fila((select id from public.ingestion_rows
  where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number = 5), 'descartar')$$, 'una fila resuelta no se decide dos veces');

-- La misma planilla otra vez: todo duplicado.
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total, channel, source_system, status)
values ('60000000-0000-0000-0000-0000000000e2', :B, 'ventas', 'gestion-nov.xlsx', 'h2', 0, 'archivo', 'archivo', 'preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000e2', (select jsonb_agg(jsonb_build_object('row', row_number, 'data', data))
  from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e1' and row_number <= 3));
select pg_temp.expect((select count(*) from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e2' and status = 'duplicada') = 2,
  'volver a importar las mismas filas no duplica');

-- Deshacer el primer lote: se quitan las ventas importadas y la consulta vinculada vuelve a estar abierta.
select public.deshacer_importacion('60000000-0000-0000-0000-0000000000e1');
select pg_temp.expect((select count(*) from public.sales where description = 'Pantalla A10') = 0, 'deshacer quita las ventas del lote');
select pg_temp.expect((select o.stage from public.opportunities o where o.need = 'Batería') = 'en_seguimiento', 'la consulta vinculada vuelve a quedar abierta');
select pg_temp.expect((select count(*) from public.external_refs where import_id = '60000000-0000-0000-0000-0000000000e1') = 0,
  'y se quitan sus referencias externas');

-- ── Ingestión: consultas por día ──
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total, channel, source_system, status)
values ('60000000-0000-0000-0000-0000000000e3', :B, 'consultas', 'consultas.csv', 'h3', 0, 'google_sheets', 'sheets:demo', 'preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000e3', '[{"row":2,"data":{"fecha":"2026-10-01","consultas":5}}]');
select public.aplicar_lote('60000000-0000-0000-0000-0000000000e3');
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total, channel, source_system, status)
values ('60000000-0000-0000-0000-0000000000e4', :B, 'consultas', 'consultas.csv', 'h4', 0, 'google_sheets', 'sheets:demo', 'preparada');
select public.preparar_lote('60000000-0000-0000-0000-0000000000e4', '[{"row":2,"data":{"fecha":"2026-10-01","consultas":5}},{"row":3,"data":{"fecha":"2026-10-01","consultas":7}}]');
select pg_temp.expect((select string_agg(status, ',' order by row_number) from public.ingestion_rows where import_id = '60000000-0000-0000-0000-0000000000e4')
  = 'duplicada,dudosa', 'mismo total del día = duplicado; total distinto = dudoso');

-- ── Aislamiento ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2"}', false);
select pg_temp.expect((select count(*) from public.funnels) + (select count(*) from public.funnel_activities)
  + (select count(*) from public.ingestion_rows) + (select count(*) from public.external_refs) = 0,
  'el otro alumno no ve embudos, actividad ni importaciones ajenas');
select pg_temp.expect_error($$select public.crear_embudo('10000000-0000-0000-0000-0000000000e1', 'local')$$,
  'no se activan embudos en un negocio ajeno');
select pg_temp.expect_error($$select public.decidir_fila((select id from public.ingestion_rows limit 1), 'descartar')$$,
  'no se deciden filas ajenas');

-- ── Mentor ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', false);
select pg_temp.expect_error($$update public.businesses set program_start = '2026-06-01' where id = '10000000-0000-0000-0000-0000000000e1'$$,
  'el alumno no fija su mes de ingreso');
select pg_temp.expect_error($$insert into public.mentor_notes (business_id, body) values ('10000000-0000-0000-0000-0000000000e1', 'x')$$,
  'el alumno no escribe notas del mentor');
reset role;
select set_config('request.jwt.claims', '{}', false);
update public.profiles set is_mentor = true where id = '00000000-0000-0000-0000-0000000000e2';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2"}', false);
update public.businesses set program_start = '2026-06-01' where id = '10000000-0000-0000-0000-0000000000e1';
insert into public.mentor_notes (business_id, body) values (:B, 'Acordamos 3 reels por semana');
insert into public.business_baselines (business_id, consultas, clientes, facturacion, currency) values (:B, 74, 21, 215000000, 'ARS');
select pg_temp.expect((select count(*) from public.mentor_notes) = 1, 'el mentor escribe y lee sus notas');
select public.crear_embudo(:B, null, 'Sorteos en Instagram', '[{"key":"sorteos","label":"Sorteos","unit":"cantidad"},{"key":"participantes","label":"Participantes","unit":"personas"}]', 'organico');
select public.versionar_embudo((select id from public.funnels where template_key = 'tiktok_live'),
  '[{"key":"lives","label":"Lives","unit":"cantidad"},{"key":"espectadores_unicos","label":"Espectadores únicos","unit":"personas"},{"key":"comentarios","label":"Comentarios","unit":"cantidad"}]',
  current_date + 1, 'Agrego comentarios');
select pg_temp.expect((select count(*) from public.funnel_versions v join public.funnels f on f.id = v.funnel_id where f.template_key = 'tiktok_live') = 2,
  'el mentor versiona los pasos');
select pg_temp.expect((select count(*) from public.funnel_activities a join public.funnel_versions v on v.id = a.version_id where v.version = 1) = 1,
  'la actividad vieja conserva su versión');
select pg_temp.expect((select count(*) from public.audit_log where table_name in ('mentor_notes', 'business_baselines')) = 0,
  'las notas no quedan en la auditoría que lee el alumno');
reset role;
select set_config('request.jwt.claims', '{}', false);
update public.profiles set is_mentor = false where id = '00000000-0000-0000-0000-0000000000e2';

\echo 'Todos los tests de la V1.3 pasaron'
