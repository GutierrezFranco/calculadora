-- Datos cargados antes de V1.3 (se insertan con las migraciones anteriores ya aplicadas).
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1');
insert into public.businesses (id, name) values ('10000000-0000-0000-0000-0000000000f1', 'Taller Histórico');
insert into public.memberships values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1"}', false);
select public.crear_oportunidad('10000000-0000-0000-0000-0000000000f1', 'Pantalla', 'Ana', '+5491180000001', 'organico');
select public.crear_oportunidad('10000000-0000-0000-0000-0000000000f1', 'Batería', 'Beto', '+5491180000002', 'desconocido');
select public.crear_oportunidad('10000000-0000-0000-0000-0000000000f1', 'Módulo', 'Caro', '+5491180000003', 'referido');
select public.ganar_oportunidad((select id from public.opportunities where need = 'Módulo'), 5000000, 'ARS', 5000000);
select public.registrar_venta_rapida('10000000-0000-0000-0000-0000000000f1', 100000, 'ARS', 100000, 'Funda');
