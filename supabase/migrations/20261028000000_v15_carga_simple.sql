-- MDM OS · V1.5 · Carga simple y rentabilidad por embudo.
-- 1) Nombres simples para los embudos que más usan los alumnos y uno nuevo: anuncios a Instagram (mensajes).
-- 2) Publicidad por mes: cuánto invirtió el alumno en cada embudo y cuántas consultas le generó.
--    Una fila por embudo y mes: corregir un mes la reemplaza (no se suman copias del mismo período).
--    Los clientes cerrados no se cargan acá: salen de las reparaciones y ventas con ese origen.
begin;

update public.funnel_templates set name = 'Conocido / recomendado' where key = 'recomendaciones';
update public.funnel_templates set name = 'Tráfico al perfil' where key = 'meta_perfil';
update public.funnel_templates set name = 'Anuncios a WhatsApp' where key = 'meta_whatsapp';
insert into public.funnel_templates (key, name, channel, description, steps, allows_direct_sales, sort) values
  ('meta_instagram', 'Anuncios a Instagram (mensajes)', 'meta_ads', 'Inversión → mensajes por Instagram → consultas',
   '[{"key":"inversion","label":"Inversión","unit":"dinero"},{"key":"conversaciones","label":"Mensajes recibidos","unit":"cantidad"}]', false, 3)
on conflict (key) do nothing;

create table public.funnel_months (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  funnel_id uuid not null,
  month date not null check (extract(day from month) = 1),
  -- En unidades mínimas (centavos) de la moneda del negocio. null = no lo cargó.
  spend bigint check (spend >= 0),
  currency char(3) not null,
  inquiries int check (inquiries >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, funnel_id) references public.funnels (business_id, id) on delete cascade,
  unique (business_id, funnel_id, month)
);
create index on public.funnel_months (business_id, month);

alter table public.funnel_months enable row level security;
create policy "ver" on public.funnel_months for select to authenticated using (app.can_access(business_id));
create policy "crear" on public.funnel_months for insert to authenticated with check (app.can_access(business_id));
create policy "editar" on public.funnel_months for update to authenticated using (app.can_access(business_id)) with check (app.can_access(business_id));
create policy "borrar" on public.funnel_months for delete to authenticated using (app.can_access(business_id));
create trigger audit after insert or update or delete on public.funnel_months for each row execute function app.audit();
grant select, insert, update, delete on public.funnel_months to authenticated;

commit;
