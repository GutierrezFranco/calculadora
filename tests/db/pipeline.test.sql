-- Pipeline en la base: señas, ganar, saldo, revertir, perder, reabrir e importar.
-- Criterios 4 a 7 de la especificación a nivel base de datos. Datos ficticios.
\set ON_ERROR_STOP on

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1');
insert into public.businesses (id, name, usd_rate) values ('10000000-0000-0000-0000-0000000000c1', 'Taller Demo Pipeline', 1450);
insert into public.memberships values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1');

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
create function pg_temp.stage(opp uuid) returns text language sql as $$
  select stage::text from public.opportunities where id = opp;
$$;
create function pg_temp.net_paid(opp uuid) returns bigint language sql as $$
  select coalesce(sum(case when kind = 'devolucion' then -amount else amount end), 0)
  from public.payments where opportunity_id = opp;
$$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', false);

-- Criterio 4: presupuesto de $100.000 y seña de $20.000 sin aceptación firme.
create temp table t (opp uuid, sale uuid);
insert into t (opp) select public.crear_oportunidad('10000000-0000-0000-0000-0000000000c1', 'Cambio de pantalla',
  'Cliente Demo', '+5491100000001');
select public.registrar_presupuesto((select opp from t), 10000000, 'ARS');
select pg_temp.expect(pg_temp.stage((select opp from t)) = 'presupuestado', 'el presupuesto pasa la oportunidad a Presupuestado');
select public.registrar_cobro((select opp from t), 2000000, 'ARS', 'efectivo');
select pg_temp.expect(pg_temp.stage((select opp from t)) = 'senado', 'la seña pasa la oportunidad a Señado');
select pg_temp.expect((select count(*) from public.sales) = 0, 'con seña sola no hay venta');
select pg_temp.expect((select kind::text from public.payments) = 'sena', 'el cobro sin venta es una seña');
select pg_temp.expect_error(format('select public.mover_oportunidad(%L, %L)', (select opp from t), 'ganado_en_reparacion'),
  'no se gana moviendo la tarjeta');
select pg_temp.expect_error(format('update public.opportunities set stage = %L where id = %L', 'ganado_completado', (select opp from t)),
  'no se gana sin venta ni por fuera de las funciones');

-- Criterio 5: acepta la reparación por $100.000 y deja $50.000 de anticipo.
update t set sale = public.ganar_oportunidad(opp, 10000000, 'ARS', 5000000, 3000000);
select pg_temp.expect(pg_temp.stage((select opp from t)) = 'ganado_en_reparacion', 'ganar deja la oportunidad en reparación');
select pg_temp.expect((select count(*) from public.sales where status = 'vigente') = 1, 'una venta ganada');
select pg_temp.expect(pg_temp.net_paid((select opp from t)) = 7000000, 'cobrado: seña + anticipo');
select pg_temp.expect_error(format('select public.ganar_oportunidad(%L, 1, %L)', (select opp from t), 'ARS'), 'no se gana dos veces');
select public.mover_oportunidad((select opp from t), 'ganado_completado');
select pg_temp.expect_error(format('select public.mover_oportunidad(%L, %L)', (select opp from t), 'en_seguimiento'),
  'una venta ganada no vuelve atrás');

-- Criterio 6: cobro del saldo. Sigue siendo una venta.
select public.registrar_cobro((select opp from t), 3000000, 'ARS');
select pg_temp.expect((select kind::text from public.payments order by paid_at desc, kind desc limit 1) in ('saldo', 'anticipo'), 'el cobro después de ganar es saldo');
select pg_temp.expect((select count(*) from public.payments where kind = 'saldo') = 1, 'queda registrado como saldo');
select pg_temp.expect((select count(*) from public.sales) = 1, 'sigue habiendo una sola venta');
select pg_temp.expect(pg_temp.net_paid((select opp from t)) = 10000000, 'cobrado total $100.000');

-- Criterio 7: reversión con devolución, sin borrar nada y sin devolver dos veces.
select pg_temp.expect_error(format('select public.revertir_venta(%L, %L)', (select sale from t), ''), 'revertir exige motivo');
select public.revertir_venta((select sale from t), 'El cliente se arrepintió', true);
select pg_temp.expect((select status::text from public.sales) = 'revertida', 'la venta queda revertida');
select pg_temp.expect(pg_temp.net_paid((select opp from t)) = 0, 'se devolvió todo lo cobrado');
select pg_temp.expect((select count(*) from public.payments where kind <> 'devolucion') = 3, 'los cobros originales siguen');
select pg_temp.expect(pg_temp.stage((select opp from t)) = 'perdido', 'la oportunidad revertida queda perdida');
select pg_temp.expect((select count(*) from public.sale_adjustments) = 1, 'queda el ajuste de anulación');
select pg_temp.expect_error(format('select public.revertir_venta(%L, %L)', (select sale from t), 'otra vez'), 'no se revierte dos veces');

-- Seña retenida y seña devuelta.
truncate t;
insert into t (opp) select public.crear_oportunidad('10000000-0000-0000-0000-0000000000c1', 'Batería', null, '+5491100000001');
select pg_temp.expect((select count(*) from public.contacts) = 1, 'el mismo teléfono reusa el contacto');
select public.registrar_cobro((select opp from t), 1000000, 'ARS');
select public.perder_oportunidad((select opp from t), 'No volvió', false);
select pg_temp.expect(pg_temp.net_paid((select opp from t)) = 1000000, 'seña no devuelta queda retenida');
select public.reabrir_oportunidad((select opp from t));
select pg_temp.expect(pg_temp.stage((select opp from t)) = 'en_seguimiento'
  and (select lost_at from public.opportunities where id = (select opp from t)) is null, 'reabrir limpia la pérdida');
select public.perder_oportunidad((select opp from t), 'Ahora sí, no sigue', true);
select pg_temp.expect(pg_temp.net_paid((select opp from t)) = 0, 'seña devuelta si se pide');
select pg_temp.expect_error(format('select public.registrar_cobro(%L, 1, %L)', (select opp from t), 'ARS'), 'no se cobra una oportunidad perdida');

-- Importación de ventas: una sola vez.
insert into public.data_imports (id, business_id, kind, file_name, file_hash, rows_total)
values ('60000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'ventas', 'ventas.xlsx', 'abc', 2);
select public.importar_ventas('60000000-0000-0000-0000-0000000000c1', '[
  {"fecha": "2026-03-01T15:00:00Z", "monto": 5000000, "cobrado": 5000000, "moneda": "ARS", "descripcion": "Módulo", "cliente": "Importado Uno"},
  {"fecha": "2026-03-02T15:00:00Z", "monto": 2000000, "cobrado": 1000000, "moneda": "ARS", "telefono": "+5491100000009"}
]'::jsonb);
select pg_temp.expect((select count(*) from public.opportunities where import_id = '60000000-0000-0000-0000-0000000000c1') = 2,
  'las ventas importadas quedan marcadas con su importación');
select pg_temp.expect((select rows_imported from public.data_imports) = 2, 'la importación registra las filas');
select pg_temp.expect_error($$select public.importar_ventas('60000000-0000-0000-0000-0000000000c1', '[]'::jsonb)$$,
  'una importación no se procesa dos veces');

reset role;
\echo 'Todos los tests del pipeline pasaron'
