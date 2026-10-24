-- MDM OS · V1A · Núcleo comercial
-- Importes en unidades mínimas (centavos) como bigint, siempre con su moneda.
-- Cada tabla de negocio lleva business_id y las FKs compuestas impiden
-- vincular registros de negocios distintos.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ───────────────────────── Tipos ─────────────────────────

create type app.stage as enum (
  'nueva_consulta', 'presupuestado', 'en_seguimiento', 'senado',
  'ganado_en_reparacion', 'ganado_completado', 'perdido'
);
create type app.lead_source as enum (
  'organico', 'meta_ads', 'prospeccion', 'referido', 'directo', 'desconocido', 'otro'
);
create type app.sale_status as enum ('vigente', 'revertida');
create type app.payment_kind as enum ('sena', 'anticipo', 'saldo', 'pago_total', 'devolucion');
create type app.adjustment_kind as enum ('anulacion', 'devolucion_parcial');
create type app.tally_method as enum ('manual', 'importado', 'whatsapp');
create type app.actor_kind as enum ('usuario', 'mentor', 'ia', 'importacion');

-- ───────────────────────── Personas y negocios ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  is_mentor boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  zone text,
  currency char(3) not null default 'ARS',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  -- Cotización de referencia: unidades de la moneda local por 1 USD.
  usd_rate numeric(18, 6) check (usd_rate > 0),
  deposits_refundable boolean not null default false,
  -- El mentor activa o desactiva el acceso del alumno.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.memberships (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- ───────────────────────── Autorización ─────────────────────────

create function app.is_mentor() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_mentor from public.profiles p where p.id = auth.uid()), false);
$$;

-- El mentor accede a todos los negocios; el alumno solo a los suyos y si están activos.
create function app.can_access(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_mentor() or exists (
    select 1
    from public.memberships m
    join public.businesses b on b.id = m.business_id
    where m.business_id = target and m.user_id = auth.uid() and b.active
  );
$$;

-- ───────────────────────── Comercial ─────────────────────────

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text,
  first_contact_at timestamptz not null default now(),
  -- Si se detecta un duplicado, se fusiona apuntando al contacto que queda.
  merged_into uuid references public.contacts (id),
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.contact_phones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  contact_id uuid not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  foreign key (business_id, contact_id) references public.contacts (business_id, id) on delete cascade,
  unique (business_id, phone_e164)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  contact_id uuid not null,
  created_at timestamptz not null default now(),
  stage app.stage not null default 'nueva_consulta',
  source app.lead_source not null default 'desconocido',
  sub_source text,
  source_evidence text,
  need text,
  last_interaction_at timestamptz,
  next_follow_up_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  foreign key (business_id, contact_id) references public.contacts (business_id, id),
  unique (business_id, id),
  check ((stage = 'perdido') = (lost_at is not null))
);
create index on public.opportunities (business_id, created_at);
create index on public.opportunities (business_id, stage);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  opportunity_id uuid not null,
  version int not null default 1,
  amount bigint not null check (amount >= 0),
  currency char(3) not null,
  quoted_at timestamptz not null default now(),
  sent boolean not null default false,
  accepted boolean,
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id),
  unique (opportunity_id, version)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  opportunity_id uuid not null,
  contact_id uuid not null,
  amount bigint not null check (amount >= 0),
  currency char(3) not null,
  -- null = costo todavía no cargado: la contribución queda "Sin datos".
  direct_cost bigint check (direct_cost >= 0),
  variable_costs bigint check (variable_costs >= 0),
  won_at timestamptz not null default now(),
  status app.sale_status not null default 'vigente',
  description text,
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id),
  foreign key (business_id, contact_id) references public.contacts (business_id, id),
  unique (business_id, id)
);
create index on public.sales (business_id, won_at);
-- Una oportunidad tiene como mucho una venta vigente.
create unique index sales_one_active_per_opportunity on public.sales (opportunity_id) where status = 'vigente';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  opportunity_id uuid not null,
  sale_id uuid,
  amount bigint not null check (amount > 0),
  currency char(3) not null,
  kind app.payment_kind not null,
  method text,
  paid_at timestamptz not null default now(),
  refunds_payment_id uuid references public.payments (id),
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id),
  foreign key (business_id, sale_id) references public.sales (business_id, id),
  check ((kind = 'devolucion') = (refunds_payment_id is not null))
);
create index on public.payments (business_id, paid_at);

create table public.sale_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sale_id uuid not null,
  kind app.adjustment_kind not null,
  amount_delta bigint not null check (amount_delta <= 0),
  currency char(3) not null,
  at timestamptz not null default now(),
  reason text not null,
  foreign key (business_id, sale_id) references public.sales (business_id, id)
);

create table public.stage_history (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  opportunity_id uuid not null,
  from_stage app.stage,
  to_stage app.stage not null,
  actor_id uuid,
  actor_kind app.actor_kind not null default 'usuario',
  at timestamptz not null default now(),
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id)
);

-- Total de consultas calificadas por día. Si existe para un día, manda sobre
-- las oportunidades creadas ese día (no se suman ambos).
create table public.inquiry_tallies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  date date not null,
  count int not null check (count >= 0),
  method app.tally_method not null default 'manual',
  loaded_at timestamptz not null default now(),
  unique (business_id, date, method)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  metric text not null,
  target bigint not null check (target >= 0),
  currency char(3),
  period_kind text not null check (period_kind in ('mensual', 'trimestral')),
  period_start date not null,
  notes text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Auditoría ─────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (business_id, at);

create table public.mentor_access_log (
  id bigint generated always as identity primary key,
  mentor_id uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  resource text not null,
  at timestamptz not null default now()
);

create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(new_row, old_row);
begin
  insert into public.audit_log (business_id, actor_id, table_name, record_id, action, before, after)
  values (
    coalesce((row_data ->> 'business_id')::uuid, case when tg_table_name = 'businesses' then (row_data ->> 'id')::uuid end),
    auth.uid(), tg_table_name, row_data ->> 'id', lower(tg_op), old_row, new_row
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['businesses', 'memberships', 'contacts', 'contact_phones', 'opportunities',
                           'quotes', 'sales', 'payments', 'sale_adjustments', 'inquiry_tallies', 'goals']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit()', t);
  end loop;
end;
$$;

create function app.record_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.stage_history (business_id, opportunity_id, from_stage, to_stage, actor_id)
    values (new.business_id, new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, auth.uid());
  end if;
  return new;
end;
$$;
create trigger stage_history after insert or update of stage on public.opportunities
  for each row execute function app.record_stage_change();

-- Ventas y cobros no se reescriben: los cambios de monto van como ajustes o devoluciones.
create function app.guard_sale_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.amount <> old.amount or new.currency <> old.currency or new.opportunity_id <> old.opportunity_id then
    raise exception 'El monto pactado no se edita: registrá un ajuste';
  end if;
  if old.status = 'revertida' and new.status <> 'revertida' then
    raise exception 'Una venta revertida no vuelve a estar vigente';
  end if;
  return new;
end;
$$;
create trigger guard_sale_update before update on public.sales
  for each row execute function app.guard_sale_update();

create function app.guard_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% no se modifica: registrá una devolución o un ajuste', tg_table_name;
end;
$$;
create trigger guard_payment_update before update on public.payments
  for each row execute function app.guard_immutable();
create trigger guard_adjustment_update before update on public.sale_adjustments
  for each row execute function app.guard_immutable();

-- Una devolución no puede superar lo que queda por devolver del cobro original.
-- security definer: debe ver el cobro original aunque el usuario no pueda editarlo.
create function app.guard_refund() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  original public.payments;
  refunded bigint;
begin
  if new.kind <> 'devolucion' then return new; end if;
  select * into original from public.payments where id = new.refunds_payment_id for update;
  if not found or original.kind = 'devolucion' or original.business_id <> new.business_id or original.currency <> new.currency then
    raise exception 'La devolución no corresponde a un cobro válido';
  end if;
  select coalesce(sum(amount), 0) into refunded
  from public.payments where refunds_payment_id = original.id;
  if refunded + new.amount > original.amount then
    raise exception 'La devolución supera lo cobrado (quedan % por devolver)', original.amount - refunded;
  end if;
  return new;
end;
$$;
create trigger guard_refund before insert on public.payments
  for each row execute function app.guard_refund();

-- Solo el mentor cambia el estado activo de un negocio o marca mentores.
create function app.guard_business_active() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active is distinct from old.active and not app.is_mentor() then
    raise exception 'Solo el mentor activa o desactiva negocios';
  end if;
  return new;
end;
$$;
create trigger guard_business_active before update on public.businesses
  for each row execute function app.guard_business_active();

create function app.guard_profile_mentor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_mentor is distinct from old.is_mentor and not app.is_mentor() then
    raise exception 'Solo un mentor puede asignar el rol de mentor';
  end if;
  return new;
end;
$$;
create trigger guard_profile_mentor before update on public.profiles
  for each row execute function app.guard_profile_mentor();

-- El mentor registra cada vez que abre el panel de un alumno.
create function app.log_mentor_access(target uuid, resource text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_mentor() then raise exception 'Solo para mentores'; end if;
  insert into public.mentor_access_log (mentor_id, business_id, resource) values (auth.uid(), target, resource);
end;
$$;

-- ───────────────────────── Políticas de acceso ─────────────────────────

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.mentor_access_log enable row level security;

create policy "ver perfil propio o mentor" on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_mentor());
create policy "editar perfil propio" on public.profiles for update to authenticated
  using (id = auth.uid() or app.is_mentor());

create policy "ver negocio" on public.businesses for select to authenticated using (app.can_access(id));
create policy "mentor crea negocios" on public.businesses for insert to authenticated with check (app.is_mentor());
create policy "editar negocio" on public.businesses for update to authenticated using (app.can_access(id));

create policy "ver membresías" on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_mentor());
create policy "mentor gestiona membresías" on public.memberships for all to authenticated
  using (app.is_mentor()) with check (app.is_mentor());

create policy "ver auditoría" on public.audit_log for select to authenticated using (app.can_access(business_id));
create policy "mentor ve accesos" on public.mentor_access_log for select to authenticated using (app.is_mentor());

-- El historial de etapas solo lo escribe el trigger.
alter table public.stage_history enable row level security;
create policy "ver" on public.stage_history for select to authenticated using (app.can_access(business_id));

-- Tablas operativas: leer, crear y editar dentro del propio negocio.
-- Sin políticas de borrado en ventas, cobros, ajustes e historial: no hay borrados destructivos.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'contact_phones', 'opportunities', 'quotes', 'sales', 'payments',
                           'sale_adjustments', 'inquiry_tallies', 'goals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "ver" on public.%I for select to authenticated using (app.can_access(business_id))', t);
    execute format('create policy "crear" on public.%I for insert to authenticated with check (app.can_access(business_id))', t);
  end loop;
  foreach t in array array['contacts', 'contact_phones', 'opportunities', 'quotes', 'sales', 'inquiry_tallies', 'goals']
  loop
    execute format('create policy "editar" on public.%I for update to authenticated using (app.can_access(business_id))', t);
  end loop;
  foreach t in array array['contact_phones', 'quotes', 'inquiry_tallies', 'goals']
  loop
    execute format('create policy "borrar" on public.%I for delete to authenticated using (app.can_access(business_id))', t);
  end loop;
end;
$$;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
