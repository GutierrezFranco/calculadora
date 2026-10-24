-- MDM OS · Instalación completa de la base de datos
-- Copiá TODO este archivo, pegalo en Supabase → SQL Editor → New query y tocá Run.
-- Es para un proyecto nuevo y vacío. Generado con scripts/build-install-sql.sh: no editar a mano.

-- ═══════════════ 20261024000000_v1a_nucleo.sql ═══════════════

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

-- Cada cuenta de Supabase Auth tiene su perfil.
create function app.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;
create trigger create_profile after insert on auth.users
  for each row execute function app.create_profile();

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
  -- Cotización del negocio al registrar la venta (moneda local por 1 USD).
  usd_rate numeric(18, 6) check (usd_rate > 0),
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
  -- Cotización del negocio al registrar el cobro (moneda local por 1 USD).
  usd_rate numeric(18, 6) check (usd_rate > 0),
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

-- Si no se indica, la venta o el cobro toman la cotización cargada en el negocio en ese momento.
create function app.snapshot_usd_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.usd_rate is null then
    select b.usd_rate into new.usd_rate from public.businesses b where b.id = new.business_id;
  end if;
  return new;
end;
$$;
create trigger snapshot_usd_rate before insert on public.sales
  for each row execute function app.snapshot_usd_rate();
create trigger snapshot_usd_rate before insert on public.payments
  for each row execute function app.snapshot_usd_rate();

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
-- Sin usuario (editor SQL de Supabase o clave de servicio) se permite, para crear el primer mentor.
create function app.guard_business_active() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active is distinct from old.active and auth.uid() is not null and not app.is_mentor() then
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
  if new.is_mentor is distinct from old.is_mentor and auth.uid() is not null and not app.is_mentor() then
    raise exception 'Solo un mentor puede asignar el rol de mentor';
  end if;
  return new;
end;
$$;
create trigger guard_profile_mentor before update on public.profiles
  for each row execute function app.guard_profile_mentor();

-- El mentor registra cada vez que abre el panel de un alumno.
create function public.registrar_acceso_mentor(target uuid, resource text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_mentor() then raise exception 'Solo para mentores'; end if;
  insert into public.mentor_access_log (mentor_id, business_id, resource) values (auth.uid(), target, resource);
end;
$$;

-- ───────────────────────── Carga rápida ─────────────────────────

-- Venta directa (mostrador, accesorio, reparación ya resuelta): crea contacto si hace
-- falta, oportunidad ganada, venta y cobro en una sola operación. Corre con los
-- permisos del usuario, así que las políticas de acceso se aplican igual.
create function public.registrar_venta_rapida(
  p_business uuid,
  p_amount bigint,
  p_currency text,
  p_paid bigint,
  p_description text default null,
  p_contact_name text default null,
  p_phone text default null,
  p_direct_cost bigint default null,
  p_source text default 'desconocido',
  p_won_at timestamptz default now()
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_contact uuid;
  v_opp uuid;
  v_sale uuid;
begin
  if p_paid < 0 or p_paid > p_amount then
    raise exception 'El cobrado tiene que estar entre 0 y el monto de la venta';
  end if;
  if nullif(p_phone, '') is not null then
    select contact_id into v_contact from public.contact_phones
    where business_id = p_business and phone_e164 = p_phone;
  end if;
  if v_contact is null then
    insert into public.contacts (business_id, name, first_contact_at)
    values (p_business, nullif(p_contact_name, ''), p_won_at) returning id into v_contact;
    if nullif(p_phone, '') is not null then
      insert into public.contact_phones (business_id, contact_id, phone_e164) values (p_business, v_contact, p_phone);
    end if;
  end if;
  insert into public.opportunities (business_id, contact_id, created_at, stage, source, need, last_interaction_at)
  values (p_business, v_contact, p_won_at, 'ganado_completado', p_source::app.lead_source, p_description, p_won_at)
  returning id into v_opp;
  insert into public.sales (business_id, opportunity_id, contact_id, amount, currency, direct_cost, won_at, description)
  values (p_business, v_opp, v_contact, p_amount, p_currency, p_direct_cost, p_won_at, p_description)
  returning id into v_sale;
  if p_paid > 0 then
    insert into public.payments (business_id, opportunity_id, sale_id, amount, currency, kind, paid_at)
    values (p_business, v_opp, v_sale, p_paid, p_currency,
            case when p_paid = p_amount then 'pago_total' else 'anticipo' end::app.payment_kind, p_won_at);
  end if;
  return v_sale;
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

-- service_role (clave secreta) también pasa por los triggers que usan estas funciones.
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- Las funciones públicas son solo para usuarios logueados.
revoke execute on function public.registrar_venta_rapida, public.registrar_acceso_mentor from public, anon;
grant execute on function public.registrar_venta_rapida, public.registrar_acceso_mentor to authenticated;

-- ═══════════════ 20261024010000_v1a_pipeline.sql ═══════════════

-- MDM OS · V1A · Pipeline comercial, importaciones y objetivos
-- Cada acción del pipeline es una función que corre con los permisos del usuario
-- (las políticas de acceso se aplican) y hace todos sus cambios juntos o ninguno.

-- ───────────────────────── Importaciones ─────────────────────────

create table public.data_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('ventas', 'consultas')),
  file_name text not null,
  -- Huella del archivo: el mismo archivo no se importa dos veces sin confirmarlo.
  file_hash text not null,
  rows_total int not null,
  rows_imported int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.data_imports (business_id, file_hash);

alter table public.opportunities add column import_id uuid references public.data_imports (id);
alter table public.inquiry_tallies add column import_id uuid references public.data_imports (id);

alter table public.data_imports enable row level security;
create policy "ver" on public.data_imports for select to authenticated using (app.can_access(business_id));
create policy "crear" on public.data_imports for insert to authenticated with check (app.can_access(business_id));
-- Las funciones de importación actualizan el conteo de filas (y bloquean la fila mientras importan).
create policy "editar" on public.data_imports for update to authenticated using (app.can_access(business_id));
create trigger audit after insert or update or delete on public.data_imports
  for each row execute function app.audit();

-- Un objetivo por métrica y mes.
alter table public.goals add constraint goals_one_per_period unique (business_id, metric, period_kind, period_start);
alter table public.goals add constraint goals_metric check (metric in ('facturacion', 'cobrado', 'ventas', 'consultas'));

-- ───────────────────────── Guardas de etapa ─────────────────────────

-- Ganar exige una venta vigente; una oportunidad ganada no vuelve atrás salvo revirtiendo la venta.
create function app.guard_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  has_sale boolean;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  select exists (select 1 from public.sales where opportunity_id = new.id and status = 'vigente') into has_sale;
  if new.stage in ('ganado_en_reparacion', 'ganado_completado') and not has_sale then
    raise exception 'Para pasar a ganado hay que registrar la venta con su monto pactado';
  end if;
  if old.stage in ('ganado_en_reparacion', 'ganado_completado')
     and new.stage not in ('ganado_en_reparacion', 'ganado_completado') and has_sale then
    raise exception 'Una venta ganada no se mueve de etapa: se revierte';
  end if;
  if new.stage = 'perdido' and new.lost_at is null then
    new.lost_at := now();
  elsif new.stage <> 'perdido' then
    new.lost_at := null;
    new.lost_reason := null;
  end if;
  return new;
end;
$$;
create trigger guard_stage before update of stage on public.opportunities
  for each row execute function app.guard_stage();

-- ───────────────────────── Contactos ─────────────────────────

-- Busca el contacto por teléfono o lo crea. Devuelve su id.
create function app.contact_for(p_business uuid, p_name text, p_phone text, p_at timestamptz) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_contact uuid;
begin
  if nullif(p_phone, '') is not null then
    select contact_id into v_contact from public.contact_phones
    where business_id = p_business and phone_e164 = p_phone;
  end if;
  if v_contact is null then
    insert into public.contacts (business_id, name, first_contact_at)
    values (p_business, nullif(p_name, ''), p_at) returning id into v_contact;
    if nullif(p_phone, '') is not null then
      insert into public.contact_phones (business_id, contact_id, phone_e164) values (p_business, v_contact, p_phone);
    end if;
  elsif nullif(p_name, '') is not null then
    update public.contacts set name = coalesce(name, p_name) where id = v_contact;
  end if;
  return v_contact;
end;
$$;

-- ───────────────────────── Acciones del pipeline ─────────────────────────

create function public.crear_oportunidad(
  p_business uuid,
  p_need text,
  p_contact_name text default null,
  p_phone text default null,
  p_source text default 'desconocido',
  p_created_at timestamptz default now(),
  p_next_follow_up timestamptz default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_opp uuid;
begin
  insert into public.opportunities (business_id, contact_id, created_at, source, need, last_interaction_at, next_follow_up_at)
  values (p_business, app.contact_for(p_business, p_contact_name, p_phone, p_created_at), p_created_at,
          p_source::app.lead_source, nullif(p_need, ''), p_created_at, p_next_follow_up)
  returning id into v_opp;
  return v_opp;
end;
$$;

-- Etapas sin resultado: nueva, presupuestado, en seguimiento, señado; y completar una ganada.
create function public.mover_oportunidad(p_opp uuid, p_stage text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_stage in ('perdido', 'ganado_en_reparacion') then
    raise exception 'Para ganar o perder se usan las acciones de ganar o perder';
  end if;
  update public.opportunities set stage = p_stage::app.stage, last_interaction_at = now() where id = p_opp;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
end;
$$;

create function public.registrar_presupuesto(p_opp uuid, p_amount bigint, p_currency text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_opp public.opportunities;
  v_quote uuid;
begin
  select * into v_opp from public.opportunities where id = p_opp for update;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  insert into public.quotes (business_id, opportunity_id, version, amount, currency, sent)
  values (v_opp.business_id, p_opp,
          coalesce((select max(version) from public.quotes where opportunity_id = p_opp), 0) + 1,
          p_amount, p_currency, true)
  returning id into v_quote;
  if v_opp.stage = 'nueva_consulta' then
    update public.opportunities set stage = 'presupuestado' where id = p_opp;
  end if;
  update public.opportunities set last_interaction_at = now() where id = p_opp;
  return v_quote;
end;
$$;

-- Cobro de una oportunidad. Antes de ganar es una seña y pasa la oportunidad a Señado;
-- después de ganar es un saldo (o el pago total) de la venta.
create function public.registrar_cobro(
  p_opp uuid,
  p_amount bigint,
  p_currency text,
  p_method text default null,
  p_paid_at timestamptz default now()
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_opp public.opportunities;
  v_sale public.sales;
  v_payment uuid;
begin
  select * into v_opp from public.opportunities where id = p_opp for update;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  if v_opp.stage = 'perdido' then raise exception 'La oportunidad está perdida: reabrila antes de cobrar'; end if;
  select * into v_sale from public.sales where opportunity_id = p_opp and status = 'vigente';
  insert into public.payments (business_id, opportunity_id, sale_id, amount, currency, kind, method, paid_at)
  values (v_opp.business_id, p_opp, v_sale.id, p_amount, p_currency,
          case when v_sale.id is null then 'sena' else 'saldo' end::app.payment_kind, nullif(p_method, ''), p_paid_at)
  returning id into v_payment;
  if v_sale.id is null and v_opp.stage <> 'senado' then
    update public.opportunities set stage = 'senado' where id = p_opp;
  end if;
  update public.opportunities set last_interaction_at = now() where id = p_opp;
  return v_payment;
end;
$$;

-- Ganar: el cliente aceptó y dejó el equipo. Crea la venta y, si paga en el momento, el anticipo.
create function public.ganar_oportunidad(
  p_opp uuid,
  p_amount bigint,
  p_currency text,
  p_paid bigint default 0,
  p_direct_cost bigint default null,
  p_completed boolean default false,
  p_won_at timestamptz default now()
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_opp public.opportunities;
  v_sale uuid;
begin
  select * into v_opp from public.opportunities where id = p_opp for update;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  if v_opp.stage in ('ganado_en_reparacion', 'ganado_completado') then raise exception 'La oportunidad ya está ganada'; end if;
  if p_paid < 0 or p_paid > p_amount then raise exception 'Lo cobrado tiene que estar entre 0 y el monto pactado'; end if;
  insert into public.sales (business_id, opportunity_id, contact_id, amount, currency, direct_cost, won_at, description)
  values (v_opp.business_id, p_opp, v_opp.contact_id, p_amount, p_currency, p_direct_cost, p_won_at, v_opp.need)
  returning id into v_sale;
  if p_paid > 0 then
    insert into public.payments (business_id, opportunity_id, sale_id, amount, currency, kind, paid_at)
    values (v_opp.business_id, p_opp, v_sale, p_paid, p_currency,
            case when p_paid = p_amount then 'pago_total' else 'anticipo' end::app.payment_kind, p_won_at);
  end if;
  update public.opportunities
  set stage = case when p_completed then 'ganado_completado' else 'ganado_en_reparacion' end::app.stage,
      last_interaction_at = now()
  where id = p_opp;
  return v_sale;
end;
$$;

-- Devuelve lo que queda de cada cobro de la oportunidad (de un tipo, o todos).
create function app.refund_all(p_opp uuid, p_only_kind app.payment_kind, p_at timestamptz) returns void
language plpgsql set search_path = '' as $$
declare
  p record;
begin
  for p in
    select pay.*, pay.amount - coalesce((select sum(r.amount) from public.payments r where r.refunds_payment_id = pay.id), 0) as remaining
    from public.payments pay
    where pay.opportunity_id = p_opp and pay.kind <> 'devolucion' and (p_only_kind is null or pay.kind = p_only_kind)
  loop
    if p.remaining > 0 then
      insert into public.payments (business_id, opportunity_id, sale_id, amount, currency, kind, paid_at, refunds_payment_id, usd_rate)
      values (p.business_id, p.opportunity_id, p.sale_id, p.remaining, p.currency, 'devolucion', p_at, p.id, p.usd_rate);
    end if;
  end loop;
end;
$$;

-- Perder: solo lo confirma el usuario. La seña se devuelve si se pide; si no, queda retenida.
create function public.perder_oportunidad(p_opp uuid, p_reason text, p_refund_deposit boolean default false) returns void
language plpgsql set search_path = '' as $$
declare
  v_opp public.opportunities;
begin
  select * into v_opp from public.opportunities where id = p_opp for update;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  if v_opp.stage in ('ganado_en_reparacion', 'ganado_completado') then
    raise exception 'Una oportunidad ganada no se pierde: se revierte la venta';
  end if;
  if p_refund_deposit then perform app.refund_all(p_opp, 'sena', now()); end if;
  update public.opportunities set stage = 'perdido', lost_at = now(), lost_reason = nullif(p_reason, '') where id = p_opp;
end;
$$;

create function public.reabrir_oportunidad(p_opp uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.opportunities set stage = 'en_seguimiento', last_interaction_at = now()
  where id = p_opp and stage = 'perdido';
  if not found then raise exception 'Solo se reabre una oportunidad perdida'; end if;
end;
$$;

-- Revertir una venta: queda revertida con su ajuste, se devuelve lo cobrado si se pide
-- y la oportunidad pasa a perdida. Nada se borra.
create function public.revertir_venta(p_sale uuid, p_reason text, p_refund boolean default true) returns void
language plpgsql set search_path = '' as $$
declare
  v_sale public.sales;
begin
  if nullif(p_reason, '') is null then raise exception 'Indicá el motivo de la reversión'; end if;
  select * into v_sale from public.sales where id = p_sale for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_sale.status = 'revertida' then raise exception 'La venta ya está revertida'; end if;
  update public.sales set status = 'revertida' where id = p_sale;
  insert into public.sale_adjustments (business_id, sale_id, kind, amount_delta, currency, reason)
  values (v_sale.business_id, p_sale, 'anulacion', -v_sale.amount, v_sale.currency, p_reason);
  if p_refund then perform app.refund_all(v_sale.opportunity_id, null, now()); end if;
  update public.opportunities
  set stage = 'perdido', lost_at = now(), lost_reason = 'Venta revertida: ' || p_reason
  where id = v_sale.opportunity_id;
end;
$$;

-- ───────────────────────── Importación ─────────────────────────

-- Importa ventas ya cerradas (cada fila es una venta rápida) en una sola operación.
-- p_rows: [{fecha, monto, cobrado, costo, descripcion, cliente, telefono, moneda}]
create function public.importar_ventas(p_import uuid, p_rows jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v_import public.data_imports;
  r jsonb;
  v_sale uuid;
  n int := 0;
begin
  select * into v_import from public.data_imports where id = p_import for update;
  if not found or v_import.kind <> 'ventas' then raise exception 'Importación no encontrada'; end if;
  if v_import.rows_imported > 0 then raise exception 'Esta importación ya se procesó'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_sale := public.registrar_venta_rapida(
      v_import.business_id, (r ->> 'monto')::bigint, r ->> 'moneda',
      coalesce((r ->> 'cobrado')::bigint, (r ->> 'monto')::bigint),
      r ->> 'descripcion', r ->> 'cliente', r ->> 'telefono', (r ->> 'costo')::bigint,
      'desconocido', (r ->> 'fecha')::timestamptz);
    update public.opportunities set import_id = p_import
    where id = (select opportunity_id from public.sales where id = v_sale);
    n := n + 1;
  end loop;
  update public.data_imports set rows_imported = n where id = p_import;
  return n;
end;
$$;

-- Importa totales diarios de consultas: p_rows: [{fecha: 'YYYY-MM-DD', consultas: n}]
create function public.importar_consultas(p_import uuid, p_rows jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v_import public.data_imports;
  n int;
begin
  select * into v_import from public.data_imports where id = p_import for update;
  if not found or v_import.kind <> 'consultas' then raise exception 'Importación no encontrada'; end if;
  if v_import.rows_imported > 0 then raise exception 'Esta importación ya se procesó'; end if;
  insert into public.inquiry_tallies (business_id, date, count, method, import_id)
  select v_import.business_id, (r ->> 'fecha')::date, (r ->> 'consultas')::int, 'importado', p_import
  from jsonb_array_elements(p_rows) r
  on conflict (business_id, date, method) do update set count = excluded.count, import_id = excluded.import_id, loaded_at = now();
  get diagnostics n = row_count;
  update public.data_imports set rows_imported = n where id = p_import;
  return n;
end;
$$;

-- Un total importado y uno manual del mismo día no se suman: manda el manual
-- (lo resuelve el cálculo de métricas, src/domain/metrics.ts).

revoke execute on function
  public.crear_oportunidad, public.mover_oportunidad, public.registrar_presupuesto, public.registrar_cobro,
  public.ganar_oportunidad, public.perder_oportunidad, public.reabrir_oportunidad, public.revertir_venta,
  public.importar_ventas, public.importar_consultas
from public, anon;
grant execute on function
  public.crear_oportunidad, public.mover_oportunidad, public.registrar_presupuesto, public.registrar_cobro,
  public.ganar_oportunidad, public.perder_oportunidad, public.reabrir_oportunidad, public.revertir_venta,
  public.importar_ventas, public.importar_consultas
to authenticated;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- ═══════════════ 20261024020000_v1b.sql ═══════════════

-- MDM OS · V1B · Decisiones y captación
-- Prospección, contenido e Instagram, anuncios, escenarios de proyección, umbrales de
-- semáforo, y herramientas de corrección (deshacer importación, fusionar contactos).

-- ───────────────────────── Umbrales de semáforo ─────────────────────────

-- Verde si se alcanza al menos `semaforo_verde` del ritmo esperado; amarillo desde
-- `semaforo_amarillo`; rojo debajo. Con menos de `muestra_minima` casos no se colorea.
alter table public.businesses
  add column semaforo_verde numeric(4, 2) not null default 1.00 check (semaforo_verde > 0),
  add column semaforo_amarillo numeric(4, 2) not null default 0.80 check (semaforo_amarillo > 0),
  add column muestra_minima int not null default 10 check (muestra_minima >= 0),
  add constraint semaforo_orden check (semaforo_amarillo <= semaforo_verde);

-- ───────────────────────── Escenarios de proyección ─────────────────────────

create table public.projection_scenarios (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('principal', 'alternativo')),
  name text not null,
  -- Supuestos tal como los cargó el alumno; cada uno marca si es real o estimado.
  inputs jsonb not null,
  updated_at timestamptz not null default now(),
  unique (business_id, kind)
);

-- ───────────────────────── Prospección ─────────────────────────

create type app.prospect_status as enum (
  'no_contactado', 'contactado', 'respondio', 'interesado', 'oportunidad', 'cliente', 'descartado'
);

alter table public.data_imports drop constraint data_imports_kind_check;
alter table public.data_imports add constraint data_imports_kind_check check (kind in ('ventas', 'consultas', 'prospectos'));
alter table public.data_imports add column undone_at timestamptz, add column undone_by uuid;

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text,
  company text,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email text,
  city text,
  -- De dónde salió el dato (Google Maps, base comprada, evento…): obligación de privacidad.
  data_origin text,
  status app.prospect_status not null default 'no_contactado',
  -- Primera vez que llegó a cada etapa: alimenta las tasas de prospección.
  contacted_at timestamptz,
  responded_at timestamptz,
  interested_at timestamptz,
  converted_at timestamptz,
  discarded_at timestamptz,
  opportunity_id uuid,
  notes text,
  import_id uuid references public.data_imports (id),
  created_at timestamptz not null default now(),
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id),
  unique (business_id, id)
);
create unique index prospects_phone_unique on public.prospects (business_id, phone_e164) where phone_e164 is not null;
create index on public.prospects (business_id, status);

create table public.outreach_events (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  prospect_id uuid not null,
  status app.prospect_status not null,
  actor_id uuid default auth.uid(),
  at timestamptz not null default now(),
  foreign key (business_id, prospect_id) references public.prospects (business_id, id) on delete cascade
);

-- ───────────────────────── Contenido, cuenta y anuncios ─────────────────────────

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  url text,
  platform text not null default 'instagram' check (platform in ('instagram', 'tiktok', 'youtube', 'facebook', 'otro')),
  published_on date not null,
  topic text,
  angle text,
  format text,
  goal text,
  notes text,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

-- Métricas de un contenido en una fecha de observación (crecen con el tiempo).
create table public.content_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  content_id uuid not null,
  observed_on date not null,
  views int check (views >= 0),
  reach int check (reach >= 0),
  interactions int check (interactions >= 0),
  saves int check (saves >= 0),
  shares int check (shares >= 0),
  comments int check (comments >= 0),
  retention_pct numeric(5, 2) check (retention_pct between 0 and 100),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  foreign key (business_id, content_id) references public.content_items (business_id, id) on delete cascade
);

create table public.account_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  platform text not null default 'instagram',
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  profile_visits int check (profile_visits >= 0),
  link_clicks int check (link_clicks >= 0),
  followers int check (followers >= 0),
  reach int check (reach >= 0),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  platform text not null default 'meta',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

-- Inversión y resultados de una campaña en un rango de fechas.
create table public.ad_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  campaign_id uuid not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  spend bigint not null check (spend >= 0),
  currency char(3) not null,
  conversations int check (conversations >= 0),
  impressions int check (impressions >= 0),
  clicks int check (clicks >= 0),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  foreign key (business_id, campaign_id) references public.ad_campaigns (business_id, id) on delete cascade
);

-- ───────────────────────── Acceso y auditoría ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['projection_scenarios', 'prospects', 'content_items', 'content_metric_snapshots',
                           'account_metric_snapshots', 'ad_campaigns', 'ad_metric_snapshots']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "ver" on public.%I for select to authenticated using (app.can_access(business_id))', t);
    execute format('create policy "crear" on public.%I for insert to authenticated with check (app.can_access(business_id))', t);
    execute format('create policy "editar" on public.%I for update to authenticated using (app.can_access(business_id))', t);
    execute format('create policy "borrar" on public.%I for delete to authenticated using (app.can_access(business_id))', t);
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit()', t);
  end loop;
end;
$$;

alter table public.outreach_events enable row level security;
create policy "ver" on public.outreach_events for select to authenticated using (app.can_access(business_id));
create policy "crear" on public.outreach_events for insert to authenticated with check (app.can_access(business_id));

-- ───────────────────────── Funciones de prospección ─────────────────────────

-- Cambia el estado de un prospecto y registra la primera vez que llegó a cada etapa.
-- Llegar a una etapa implica las anteriores (quien está interesado, respondió).
create function public.cambiar_estado_prospecto(p_prospect uuid, p_status text) returns void
language plpgsql set search_path = '' as $$
declare
  v_status app.prospect_status := p_status::app.prospect_status;
  v_business uuid;
begin
  if v_status in ('oportunidad', 'cliente') then
    raise exception 'Para pasar a oportunidad se convierte el prospecto; cliente surge de la venta';
  end if;
  update public.prospects set
    status = v_status,
    contacted_at = case when v_status in ('contactado', 'respondio', 'interesado') then coalesce(contacted_at, now()) else contacted_at end,
    responded_at = case when v_status in ('respondio', 'interesado') then coalesce(responded_at, now()) else responded_at end,
    interested_at = case when v_status = 'interesado' then coalesce(interested_at, now()) else interested_at end,
    discarded_at = case when v_status = 'descartado' then now() else null end
  where id = p_prospect
  returning business_id into v_business;
  if not found then raise exception 'Prospecto no encontrado'; end if;
  insert into public.outreach_events (business_id, prospect_id, status) values (v_business, p_prospect, v_status);
end;
$$;

-- Convierte un prospecto en oportunidad del pipeline (origen: prospección).
create function public.convertir_prospecto(p_prospect uuid, p_need text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v public.prospects;
  v_opp uuid;
begin
  select * into v from public.prospects where id = p_prospect for update;
  if not found then raise exception 'Prospecto no encontrado'; end if;
  if v.opportunity_id is not null then raise exception 'El prospecto ya es una oportunidad'; end if;
  v_opp := public.crear_oportunidad(v.business_id, coalesce(nullif(p_need, ''), 'Prospección'),
    coalesce(v.name, v.company), v.phone_e164, 'prospeccion');
  update public.prospects set
    status = 'oportunidad', opportunity_id = v_opp, converted_at = now(),
    contacted_at = coalesce(contacted_at, now()), responded_at = coalesce(responded_at, now()),
    interested_at = coalesce(interested_at, now()), discarded_at = null
  where id = p_prospect;
  insert into public.outreach_events (business_id, prospect_id, status) values (v.business_id, p_prospect, 'oportunidad');
  return v_opp;
end;
$$;

-- p_rows: [{nombre, empresa, telefono, email, ciudad, origen}]. Los teléfonos repetidos se saltean.
create function public.importar_prospectos(p_import uuid, p_rows jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v_import public.data_imports;
  n int;
begin
  select * into v_import from public.data_imports where id = p_import for update;
  if not found or v_import.kind <> 'prospectos' then raise exception 'Importación no encontrada'; end if;
  if v_import.rows_imported > 0 then raise exception 'Esta importación ya se procesó'; end if;
  insert into public.prospects (business_id, name, company, phone_e164, email, city, data_origin, import_id)
  select v_import.business_id, nullif(r ->> 'nombre', ''), nullif(r ->> 'empresa', ''), nullif(r ->> 'telefono', ''),
         nullif(r ->> 'email', ''), nullif(r ->> 'ciudad', ''), coalesce(nullif(r ->> 'origen', ''), v_import.file_name), p_import
  from jsonb_array_elements(p_rows) r
  on conflict (business_id, phone_e164) where phone_e164 is not null do nothing;
  get diagnostics n = row_count;
  update public.data_imports set rows_imported = n where id = p_import;
  return n;
end;
$$;

-- ───────────────────────── Correcciones ─────────────────────────

-- Deshace una importación hecha por error. Corre con permisos elevados para poder
-- quitar ventas y cobros importados (que el usuario no puede borrar a mano), pero
-- verifica el acceso al negocio. Cada fila quitada queda en la auditoría.
create function public.deshacer_importacion(p_import uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v public.data_imports;
  n int := 0;
begin
  select * into v from public.data_imports where id = p_import for update;
  if not found or not app.can_access(v.business_id) then raise exception 'Importación no encontrada'; end if;
  if v.undone_at is not null then raise exception 'La importación ya se deshizo'; end if;

  if v.kind = 'ventas' then
    create temp table _opps on commit drop as
      select id, contact_id from public.opportunities where import_id = p_import;
    delete from public.payments where opportunity_id in (select id from _opps);
    delete from public.sale_adjustments where sale_id in (select s.id from public.sales s where s.opportunity_id in (select id from _opps));
    delete from public.sales where opportunity_id in (select id from _opps);
    delete from public.quotes where opportunity_id in (select id from _opps);
    delete from public.stage_history where opportunity_id in (select id from _opps);
    delete from public.opportunities where id in (select id from _opps);
    get diagnostics n = row_count;
    -- Contactos que solo existían por esta importación.
    delete from public.contacts c
    where c.id in (select contact_id from _opps)
      and not exists (select 1 from public.opportunities o where o.contact_id = c.id)
      and not exists (select 1 from public.sales s where s.contact_id = c.id);
  elsif v.kind = 'consultas' then
    delete from public.inquiry_tallies where import_id = p_import;
    get diagnostics n = row_count;
  else
    -- Los prospectos que ya se convirtieron en oportunidad se conservan.
    delete from public.prospects where import_id = p_import and opportunity_id is null;
    get diagnostics n = row_count;
  end if;

  update public.data_imports set undone_at = now(), undone_by = auth.uid() where id = p_import;
  return n;
end;
$$;

-- Fusiona un contacto duplicado en otro: mueve teléfonos, oportunidades y ventas.
-- El duplicado no se borra: queda apuntando al que se conserva.
create function public.fusionar_contactos(p_keep uuid, p_remove uuid) returns void
language plpgsql set search_path = '' as $$
declare
  k public.contacts;
  r public.contacts;
begin
  if p_keep = p_remove then raise exception 'Elegí dos contactos distintos'; end if;
  select * into k from public.contacts where id = p_keep for update;
  select * into r from public.contacts where id = p_remove for update;
  if k.id is null or r.id is null then raise exception 'Contacto no encontrado'; end if;
  if k.business_id <> r.business_id then raise exception 'Los contactos son de negocios distintos'; end if;
  if r.merged_into is not null or k.merged_into is not null then raise exception 'Uno de los contactos ya fue fusionado'; end if;
  update public.contact_phones set contact_id = p_keep where contact_id = p_remove;
  update public.opportunities set contact_id = p_keep where contact_id = p_remove;
  update public.sales set contact_id = p_keep where contact_id = p_remove;
  update public.contacts set
    name = coalesce(k.name, r.name),
    first_contact_at = least(k.first_contact_at, r.first_contact_at),
    notes = nullif(concat_ws(E'\n', k.notes, r.notes), '')
  where id = p_keep;
  update public.contacts set merged_into = p_keep where id = p_remove;
end;
$$;

revoke execute on function
  public.cambiar_estado_prospecto, public.convertir_prospecto, public.importar_prospectos,
  public.deshacer_importacion, public.fusionar_contactos
from public, anon;
grant execute on function
  public.cambiar_estado_prospecto, public.convertir_prospecto, public.importar_prospectos,
  public.deshacer_importacion, public.fusionar_contactos
to authenticated;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- ═══════════════ 20261024030000_primer_mentor.sql ═══════════════

-- MDM OS · El primer usuario que se crea es el mentor.
-- Así la instalación es: correr el SQL, crear tu usuario en Supabase y listo,
-- sin un segundo paso para marcarte como mentor. Los siguientes usuarios
-- (los alumnos, que crea el mentor desde la app) nunca son mentores.

create or replace function app.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, is_mentor)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    not exists (select 1 from public.profiles where is_mentor)
  );
  return new;
end;
$$;

-- ═══════════════ 20261025000000_v13_embudos.sql ═══════════════

-- MDM OS · V1.3 · Embudos, atribución, ventas directas, cancelaciones técnicas,
-- ingestión común de datos y panel del mentor. Todo es aditivo: no se borran datos
-- de alumnos. Las decisiones están en docs/arquitectura-v1-3.md.

-- ───────────────────────── Plantillas de embudo ─────────────────────────

-- Pasos de actividad propios de cada estrategia. La parte de abajo del embudo
-- (consultas → clientes → facturación) sale siempre de los datos comerciales.
create table public.funnel_templates (
  key text primary key,
  name text not null,
  channel app.lead_source not null,
  description text not null,
  steps jsonb not null,
  allows_direct_sales boolean not null default false,
  sort int not null
);

insert into public.funnel_templates (key, name, channel, description, steps, allows_direct_sales, sort) values
  ('instagram_organico', 'Instagram orgánico', 'organico', 'Reels → vistas → visitas al perfil → consultas',
   '[{"key":"publicaciones","label":"Reels publicados","unit":"cantidad"},{"key":"vistas","label":"Vistas (no personas)","unit":"cantidad"},{"key":"visitas_perfil","label":"Visitas al perfil","unit":"cantidad"}]', false, 1),
  ('meta_whatsapp', 'Meta Ads → WhatsApp', 'meta_ads', 'Inversión → conversaciones → consultas',
   '[{"key":"inversion","label":"Inversión","unit":"dinero"},{"key":"conversaciones","label":"Conversaciones iniciadas","unit":"cantidad"}]', false, 2),
  ('meta_perfil', 'Meta Ads → perfil de Instagram', 'meta_ads', 'Inversión → visitas al perfil → clics en la bio → consultas',
   '[{"key":"inversion","label":"Inversión","unit":"dinero"},{"key":"visitas_perfil","label":"Visitas al perfil de la campaña","unit":"cantidad"},{"key":"clics_bio","label":"Clics en la bio","unit":"cantidad"}]', false, 3),
  ('tiktok_organico', 'TikTok orgánico', 'organico', 'Videos → vistas → visitas al perfil → consultas',
   '[{"key":"publicaciones","label":"Videos publicados","unit":"cantidad"},{"key":"vistas","label":"Vistas (no personas)","unit":"cantidad"},{"key":"visitas_perfil","label":"Visitas al perfil","unit":"cantidad"}]', false, 4),
  ('tiktok_live', 'TikTok Live', 'organico', 'Lives → horas → espectadores únicos → consultas y ventas directas',
   '[{"key":"lives","label":"Lives","unit":"cantidad"},{"key":"horas","label":"Horas en vivo","unit":"horas"},{"key":"espectadores_unicos","label":"Espectadores únicos","unit":"personas"}]', true, 5),
  ('prospeccion', 'Prospección B2B', 'prospeccion', 'Base → contactados → respondieron → consultas',
   '[{"key":"contactados","label":"Contactados","unit":"personas"},{"key":"respondieron","label":"Respondieron","unit":"personas"}]', false, 6),
  ('recomendaciones', 'Recomendaciones', 'referido', 'Clientes que recomiendan → consultas', '[]', false, 7),
  ('local', 'Local / mostrador', 'directo', 'Gente que pasa por el local', '[]', true, 8);

alter table public.funnel_templates enable row level security;
create policy "ver" on public.funnel_templates for select to authenticated using (true);

-- Plantilla que corresponde a cada origen histórico.
create function app.default_template(p_channel app.lead_source) returns text
language sql immutable set search_path = '' as $$
  select case p_channel
    when 'organico' then 'instagram_organico'
    when 'meta_ads' then 'meta_whatsapp'
    when 'prospeccion' then 'prospeccion'
    when 'referido' then 'recomendaciones'
    when 'directo' then 'local'
  end;
$$;

-- Pasos válidos: lista de hasta 8 objetos {key, label, unit} con claves únicas.
create function app.valid_steps(p_steps jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_steps) = 'array'
    and jsonb_array_length(p_steps) <= 8
    and not exists (
      select 1 from jsonb_array_elements(p_steps) s
      where jsonb_typeof(s) <> 'object'
         or coalesce(s ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
         or length(coalesce(s ->> 'label', '')) not between 1 and 80
         or coalesce(s ->> 'unit', '') not in ('cantidad', 'personas', 'horas', 'dinero'))
    and (select count(distinct s ->> 'key') from jsonb_array_elements(p_steps) s) = jsonb_array_length(p_steps);
$$;

-- ───────────────────────── Embudos del negocio ─────────────────────────

create table public.funnels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  -- null = embudo a medida, armado por el mentor.
  template_key text references public.funnel_templates (key),
  channel app.lead_source not null default 'otro',
  status text not null default 'activo' check (status in ('activo', 'pausado', 'archivado')),
  -- Puede generar ventas sin consulta previa (TikTok Live, mostrador).
  allows_direct_sales boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, name)
);

-- Cambiar los pasos crea una versión nueva: los datos viejos quedan con la suya.
create table public.funnel_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  funnel_id uuid not null,
  version int not null check (version >= 1),
  valid_from date not null,
  steps jsonb not null check (app.valid_steps(steps)),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, funnel_id) references public.funnels (business_id, id) on delete cascade,
  unique (funnel_id, version),
  unique (funnel_id, valid_from),
  unique (business_id, id)
);

-- Registros de actividad: un live, una semana de reels, una campaña.
create table public.funnel_activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  funnel_id uuid not null,
  version_id uuid not null,
  occurred_on date not null,
  period_end date,
  label text check (length(label) <= 120),
  -- {clave_del_paso: número}
  step_values jsonb not null default '{}' check (jsonb_typeof(step_values) = 'object'),
  quality text not null default 'real' check (quality in ('real', 'estimado')),
  channel text not null default 'manual' check (channel in ('manual', 'archivo', 'google_sheets', 'conector')),
  import_id uuid references public.data_imports (id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, funnel_id) references public.funnels (business_id, id) on delete cascade,
  foreign key (business_id, version_id) references public.funnel_versions (business_id, id),
  check (period_end is null or period_end >= occurred_on)
);
create index on public.funnel_activities (business_id, funnel_id, occurred_on);

-- Crea un embudo con su versión 1.
create function app.new_funnel(
  p_business uuid, p_template text, p_name text, p_steps jsonb, p_channel app.lead_source, p_direct boolean
) returns uuid
language plpgsql set search_path = '' as $$
declare
  t public.funnel_templates;
  v_funnel uuid;
begin
  if p_template is not null then
    select * into t from public.funnel_templates where key = p_template;
    if not found then raise exception 'Plantilla desconocida'; end if;
  end if;
  insert into public.funnels (business_id, name, template_key, channel, allows_direct_sales)
  values (p_business, coalesce(nullif(trim(p_name), ''), t.name), p_template,
          coalesce(p_channel, t.channel, 'otro'), coalesce(p_direct, t.allows_direct_sales, false))
  returning id into v_funnel;
  insert into public.funnel_versions (business_id, funnel_id, version, valid_from, steps)
  values (p_business, v_funnel, 1, current_date, coalesce(p_steps, t.steps, '[]'));
  return v_funnel;
end;
$$;

-- Embudo activo de un origen; si no hay, activa la plantilla correspondiente.
create function app.ensure_funnel(p_business uuid, p_channel app.lead_source) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_funnel uuid;
  v_template text := app.default_template(p_channel);
begin
  if v_template is null then return null; end if;
  select id into v_funnel from public.funnels
  where business_id = p_business and channel = p_channel and status = 'activo'
  order by (template_key = v_template) desc nulls last, created_at limit 1;
  if v_funnel is null then
    select id into v_funnel from public.funnels where business_id = p_business and template_key = v_template limit 1;
  end if;
  return coalesce(v_funnel, app.new_funnel(p_business, v_template, null, null, null, null));
end;
$$;

-- ───────────────────────── Atribución y tipo de entrada ─────────────────────────

alter table public.opportunities
  add column funnel_id uuid,
  add column attribution_confidence text check (attribution_confidence in ('confirmada', 'declarada', 'inferida')),
  add column attributed_by uuid,
  add column attributed_at timestamptz,
  -- venta_directa: venta sin consulta previa registrada. No suma consultas ni entra en el cierre.
  add column entry_kind text not null default 'consulta' check (entry_kind in ('consulta', 'venta_directa')),
  -- Categoría de la pérdida. cancelacion_tecnica no es una pérdida comercial.
  add column lost_category text check (lost_category in ('precio', 'sin_respuesta', 'eligio_otro', 'no_reparable', 'cancelacion_tecnica', 'otro')),
  add constraint opportunities_funnel_fk foreign key (business_id, funnel_id) references public.funnels (business_id, id),
  add constraint attribution_needs_funnel check ((funnel_id is null) = (attribution_confidence is null)),
  add constraint lost_category_only_lost check (lost_category is null or stage = 'perdido');
create index on public.opportunities (business_id, funnel_id);

-- El embudo principal manda sobre el origen histórico; quien atribuye y cuándo queda registrado.
-- Si se carga solo el origen (pantallas o funciones anteriores), se usa el embudo de ese origen.
create function app.sync_attribution() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.funnel_id is null)
     or (tg_op = 'UPDATE' and new.source is distinct from old.source and new.funnel_id is not distinct from old.funnel_id) then
    if new.source not in ('desconocido', 'otro') then
      new.funnel_id := app.ensure_funnel(new.business_id, new.source);
      new.attribution_confidence := case when tg_op = 'INSERT' then coalesce(new.attribution_confidence, 'declarada') else 'declarada' end;
    else
      new.funnel_id := null;
    end if;
  end if;
  if new.funnel_id is not null then
    select f.channel into new.source from public.funnels f where f.id = new.funnel_id;
    new.attribution_confidence := coalesce(new.attribution_confidence, 'declarada');
  else
    new.attribution_confidence := null;
    if tg_op = 'UPDATE' and old.funnel_id is not null then new.source := 'desconocido'; end if;
  end if;
  if tg_op = 'INSERT' or new.funnel_id is distinct from old.funnel_id then
    if tg_op = 'INSERT' or new.attributed_at is not distinct from old.attributed_at then
      new.attributed_at := case when new.funnel_id is null then null else now() end;
    end if;
    new.attributed_by := case when new.funnel_id is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;
create trigger sync_attribution before insert or update of funnel_id, source on public.opportunities
  for each row execute function app.sync_attribution();

-- Puntos de contacto secundarios: muestran influencia, no suman clientes ni facturación.
create table public.attribution_touchpoints (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  opportunity_id uuid not null,
  funnel_id uuid not null,
  occurred_at timestamptz not null default now(),
  evidence text check (length(evidence) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, opportunity_id) references public.opportunities (business_id, id) on delete cascade,
  foreign key (business_id, funnel_id) references public.funnels (business_id, id),
  unique (opportunity_id, funnel_id)
);

create function app.guard_touchpoint() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.opportunities where id = new.opportunity_id and funnel_id = new.funnel_id) then
    raise exception 'Ese embudo ya es el principal de la oportunidad';
  end if;
  return new;
end;
$$;
create trigger guard_touchpoint before insert or update on public.attribution_touchpoints
  for each row execute function app.guard_touchpoint();

-- Fuera de "perdido" no hay categoría de pérdida (se agrega a la guarda de etapa existente).
create or replace function app.guard_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  has_sale boolean;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  select exists (select 1 from public.sales where opportunity_id = new.id and status = 'vigente') into has_sale;
  if new.stage in ('ganado_en_reparacion', 'ganado_completado') and not has_sale then
    raise exception 'Para pasar a ganado hay que registrar la venta con su monto pactado';
  end if;
  if old.stage in ('ganado_en_reparacion', 'ganado_completado')
     and new.stage not in ('ganado_en_reparacion', 'ganado_completado') and has_sale then
    raise exception 'Una venta ganada no se mueve de etapa: se revierte';
  end if;
  if new.stage = 'perdido' and new.lost_at is null then
    new.lost_at := now();
  elsif new.stage <> 'perdido' then
    new.lost_at := null;
    new.lost_reason := null;
    new.lost_category := null;
  end if;
  return new;
end;
$$;

-- ───────────────────────── Datos existentes ─────────────────────────

-- Embudos de plantilla para cada origen ya usado, y oportunidades asignadas con confianza "inferida".
do $$
declare
  r record;
begin
  for r in
    select distinct business_id, source from public.opportunities where app.default_template(source) is not null
  loop
    perform app.ensure_funnel(r.business_id, r.source);
  end loop;
end;
$$;
update public.opportunities o
set funnel_id = f.id,
    attribution_confidence = 'inferida',
    source_evidence = coalesce(o.source_evidence, 'Origen cargado antes de V1.3'),
    attributed_at = o.created_at
from public.funnels f
where o.funnel_id is null
  and f.business_id = o.business_id
  and f.template_key = app.default_template(o.source);

-- Una oportunidad cuyo primer estado ya fue "ganado" se creó con venta rápida o por
-- importación: es una venta directa, sin consulta previa.
update public.opportunities o
set entry_kind = 'venta_directa'
where (select h.to_stage from public.stage_history h where h.opportunity_id = o.id order by h.id limit 1)
      in ('ganado_en_reparacion', 'ganado_completado');

-- ───────────────────────── Ingestión común ─────────────────────────

-- Fuentes guardadas para volver a sincronizar (Google Sheets hoy, conectores después).
create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('google_sheets', 'conector')),
  name text not null check (length(name) between 1 and 120),
  data_kind text not null check (data_kind in ('ventas', 'consultas', 'oportunidades')),
  -- google_sheets: {"url": "...", "gid": "..."}
  config jsonb not null default '{}',
  mapping jsonb,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_import_id uuid references public.data_imports (id) on delete set null,
  last_error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

alter table public.data_imports drop constraint data_imports_kind_check;
alter table public.data_imports add constraint data_imports_kind_check
  check (kind in ('ventas', 'consultas', 'prospectos', 'oportunidades', 'actividad'));
alter table public.data_imports
  add column channel text not null default 'archivo' check (channel in ('manual', 'archivo', 'google_sheets', 'conector')),
  add column source_id uuid references public.data_sources (id) on delete set null,
  -- Sistema de origen para la deduplicación: misma fila de la misma fuente = duplicada.
  add column source_system text not null default 'archivo',
  -- preparada: filas revisadas sin aplicar; aplicada; deshecha.
  add column status text not null default 'aplicada' check (status in ('preparada', 'aplicada', 'deshecha')),
  add column mapping jsonb,
  add column rows_duplicate int not null default 0,
  add column rows_review int not null default 0;
update public.data_imports set status = 'deshecha' where undone_at is not null;

-- Cada fila de un lote: dato original, normalizado, coincidencia encontrada y decisión.
create table public.ingestion_rows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  import_id uuid not null references public.data_imports (id) on delete cascade,
  row_number int not null,
  raw jsonb,
  data jsonb not null,
  external_id text not null,
  status text not null check (status in ('nueva', 'duplicada', 'dudosa', 'aplicada', 'vinculada', 'descartada')),
  match_reason text,
  match_entity text check (match_entity in ('opportunity', 'sale', 'tally')),
  match_id uuid,
  target_entity text check (target_entity in ('opportunity', 'sale', 'tally')),
  target_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  unique (import_id, row_number)
);
create index on public.ingestion_rows (business_id, status);

-- (sistema de origen, id externo) → registro de MDM OS. Una misma fila no entra dos veces.
create table public.external_refs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_system text not null,
  entity text not null check (entity in ('opportunity', 'sale', 'tally')),
  external_id text not null,
  entity_id uuid not null,
  import_id uuid references public.data_imports (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, source_system, entity, external_id)
);

-- ───────────────────────── Mentor ─────────────────────────

-- Mes de ingreso al programa: línea de base del antes y después.
alter table public.businesses add column program_start date;

create function app.guard_program_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.program_start is distinct from old.program_start and auth.uid() is not null and not app.is_mentor() then
    raise exception 'Solo el mentor fija el mes de ingreso al programa';
  end if;
  return new;
end;
$$;
create trigger guard_program_start before update on public.businesses
  for each row execute function app.guard_program_start();

-- Valores declarados del mes de ingreso, cuando no hay datos cargados de ese mes.
create table public.business_baselines (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  consultas int check (consultas >= 0),
  clientes int check (clientes >= 0),
  ventas int check (ventas >= 0),
  facturacion bigint check (facturacion >= 0),
  currency char(3),
  notes text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.mentor_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  author_id uuid default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on public.mentor_notes (business_id, created_at);

-- ───────────────────────── Funciones: embudos ─────────────────────────

-- Activar una plantilla (alumno o mentor) o crear uno a medida (solo mentor).
create function public.crear_embudo(
  p_business uuid,
  p_template text default null,
  p_name text default null,
  p_steps jsonb default null,
  p_channel text default null,
  p_allows_direct boolean default null
) returns uuid
language plpgsql set search_path = '' as $$
begin
  if not app.can_access(p_business) then raise exception 'Negocio no encontrado'; end if;
  if p_template is null and not app.is_mentor() then raise exception 'Los embudos a medida los arma el mentor'; end if;
  if p_template is null and (nullif(trim(p_name), '') is null or p_steps is null) then
    raise exception 'Un embudo a medida necesita nombre y pasos';
  end if;
  if p_steps is not null and not app.valid_steps(p_steps) then raise exception 'Pasos inválidos'; end if;
  return app.new_funnel(p_business, p_template, p_name, case when p_template is null then p_steps end,
                        p_channel::app.lead_source, p_allows_direct);
end;
$$;

-- Pasos nuevos desde una fecha: crea una versión. Solo el mentor.
create function public.versionar_embudo(p_funnel uuid, p_steps jsonb, p_valid_from date, p_notes text default null) returns uuid
language plpgsql set search_path = '' as $$
declare
  f public.funnels;
  last public.funnel_versions;
  v_id uuid;
begin
  if not app.is_mentor() then raise exception 'Los pasos de un embudo los cambia el mentor'; end if;
  select * into f from public.funnels where id = p_funnel for update;
  if not found then raise exception 'Embudo no encontrado'; end if;
  if not app.valid_steps(p_steps) then raise exception 'Pasos inválidos'; end if;
  select * into last from public.funnel_versions where funnel_id = p_funnel order by version desc limit 1;
  if p_valid_from <= last.valid_from then
    raise exception 'La versión nueva tiene que empezar después del %', last.valid_from;
  end if;
  insert into public.funnel_versions (business_id, funnel_id, version, valid_from, steps, notes)
  values (f.business_id, p_funnel, last.version + 1, p_valid_from, p_steps, nullif(p_notes, ''))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cambiar_estado_embudo(p_funnel uuid, p_status text) returns void
language plpgsql set search_path = '' as $$
begin
  update public.funnels set status = p_status where id = p_funnel;
  if not found then raise exception 'Embudo no encontrado'; end if;
end;
$$;

-- Versión vigente de un embudo en una fecha (la primera cubre todo lo anterior).
create function app.version_at(p_funnel uuid, p_on date) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select id from public.funnel_versions where funnel_id = p_funnel and valid_from <= p_on order by valid_from desc limit 1),
    (select id from public.funnel_versions where funnel_id = p_funnel order by version limit 1));
$$;

create function public.registrar_actividad_embudo(
  p_funnel uuid,
  p_on date,
  p_values jsonb,
  p_quality text default 'real',
  p_label text default null,
  p_end date default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  f public.funnels;
  v public.funnel_versions;
  k text;
  val jsonb;
  v_id uuid;
begin
  select * into f from public.funnels where id = p_funnel;
  if not found then raise exception 'Embudo no encontrado'; end if;
  if p_on > current_date then raise exception 'La fecha no puede ser futura'; end if;
  select * into v from public.funnel_versions where id = app.version_at(p_funnel, p_on);
  if jsonb_typeof(p_values) <> 'object' then raise exception 'Valores inválidos'; end if;
  for k, val in select * from jsonb_each(p_values) loop
    if not exists (select 1 from jsonb_array_elements(v.steps) s where s ->> 'key' = k) then
      raise exception 'El paso "%" no existe en la versión % de este embudo', k, v.version;
    end if;
    if jsonb_typeof(val) <> 'number' or (val #>> '{}')::numeric < 0 then
      raise exception 'El valor de "%" tiene que ser un número positivo', k;
    end if;
  end loop;
  insert into public.funnel_activities (business_id, funnel_id, version_id, occurred_on, period_end, label, step_values, quality)
  values (f.business_id, p_funnel, v.id, p_on, p_end, nullif(p_label, ''), p_values, p_quality)
  returning id into v_id;
  return v_id;
end;
$$;

-- Embudo principal de una oportunidad (null = Sin atribuir).
create function public.asignar_embudo(
  p_opp uuid,
  p_funnel uuid,
  p_confidence text default 'declarada',
  p_evidence text default null
) returns void
language plpgsql set search_path = '' as $$
begin
  if p_funnel is not null then
    delete from public.attribution_touchpoints where opportunity_id = p_opp and funnel_id = p_funnel;
  end if;
  update public.opportunities
  set funnel_id = p_funnel,
      attribution_confidence = case when p_funnel is null then null else p_confidence end,
      source_evidence = coalesce(nullif(p_evidence, ''), case when p_funnel is null then null else source_evidence end)
  where id = p_opp;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
end;
$$;

create function public.agregar_punto_contacto(p_opp uuid, p_funnel uuid, p_evidence text default null) returns uuid
language plpgsql set search_path = '' as $$
declare
  o public.opportunities;
  v_id uuid;
begin
  select * into o from public.opportunities where id = p_opp;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  insert into public.attribution_touchpoints (business_id, opportunity_id, funnel_id, evidence)
  values (o.business_id, p_opp, p_funnel, nullif(p_evidence, ''))
  on conflict (opportunity_id, funnel_id) do update set evidence = coalesce(excluded.evidence, public.attribution_touchpoints.evidence)
  returning id into v_id;
  return v_id;
end;
$$;

-- ───────────────────────── Funciones: pipeline (con embudo) ─────────────────────────

-- Se reemplazan agregando parámetros al final: quien las llamaba igual sigue funcionando.
drop function public.crear_oportunidad(uuid, text, text, text, text, timestamptz, timestamptz);
create function public.crear_oportunidad(
  p_business uuid,
  p_need text,
  p_contact_name text default null,
  p_phone text default null,
  p_source text default 'desconocido',
  p_created_at timestamptz default now(),
  p_next_follow_up timestamptz default null,
  p_funnel uuid default null,
  p_confidence text default 'declarada',
  p_evidence text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_opp uuid;
begin
  insert into public.opportunities (business_id, contact_id, created_at, source, need, last_interaction_at, next_follow_up_at,
                                    funnel_id, attribution_confidence, source_evidence)
  values (p_business, app.contact_for(p_business, p_contact_name, p_phone, p_created_at), p_created_at,
          p_source::app.lead_source, nullif(p_need, ''), p_created_at, p_next_follow_up,
          p_funnel, case when p_funnel is not null then p_confidence end, nullif(p_evidence, ''))
  returning id into v_opp;
  return v_opp;
end;
$$;

-- Venta rápida: por defecto es una venta directa (sin consulta previa). Con p_direct = false
-- es una consulta que se cerró en el momento y entra en las consultas del día.
drop function public.registrar_venta_rapida(uuid, bigint, text, bigint, text, text, text, bigint, text, timestamptz);
create function public.registrar_venta_rapida(
  p_business uuid,
  p_amount bigint,
  p_currency text,
  p_paid bigint,
  p_description text default null,
  p_contact_name text default null,
  p_phone text default null,
  p_direct_cost bigint default null,
  p_source text default 'desconocido',
  p_won_at timestamptz default now(),
  p_funnel uuid default null,
  p_direct boolean default true
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_contact uuid;
  v_opp uuid;
  v_sale uuid;
begin
  if p_paid < 0 or p_paid > p_amount then
    raise exception 'El cobrado tiene que estar entre 0 y el monto de la venta';
  end if;
  v_contact := app.contact_for(p_business, p_contact_name, p_phone, p_won_at);
  insert into public.opportunities (business_id, contact_id, created_at, stage, source, need, last_interaction_at,
                                    funnel_id, attribution_confidence, entry_kind)
  values (p_business, v_contact, p_won_at, 'ganado_completado', p_source::app.lead_source, p_description, p_won_at,
          p_funnel, case when p_funnel is not null then 'declarada' end,
          case when p_direct then 'venta_directa' else 'consulta' end)
  returning id into v_opp;
  insert into public.sales (business_id, opportunity_id, contact_id, amount, currency, direct_cost, won_at, description)
  values (p_business, v_opp, v_contact, p_amount, p_currency, p_direct_cost, p_won_at, p_description)
  returning id into v_sale;
  if p_paid > 0 then
    insert into public.payments (business_id, opportunity_id, sale_id, amount, currency, kind, paid_at)
    values (p_business, v_opp, v_sale, p_paid, p_currency,
            case when p_paid = p_amount then 'pago_total' else 'anticipo' end::app.payment_kind, p_won_at);
  end if;
  return v_sale;
end;
$$;

-- Perder con categoría. La cancelación técnica tiene su propia acción.
drop function public.perder_oportunidad(uuid, text, boolean);
create function public.perder_oportunidad(
  p_opp uuid,
  p_reason text,
  p_refund_deposit boolean default false,
  p_category text default null
) returns void
language plpgsql set search_path = '' as $$
declare
  v_opp public.opportunities;
begin
  if p_category = 'cancelacion_tecnica' then raise exception 'Una cancelación técnica se registra sobre la venta'; end if;
  select * into v_opp from public.opportunities where id = p_opp for update;
  if not found then raise exception 'Oportunidad no encontrada'; end if;
  if v_opp.stage in ('ganado_en_reparacion', 'ganado_completado') then
    raise exception 'Una oportunidad ganada no se pierde: se revierte la venta';
  end if;
  if p_refund_deposit then perform app.refund_all(p_opp, 'sena', now()); end if;
  update public.opportunities
  set stage = 'perdido', lost_at = now(), lost_reason = nullif(p_reason, ''), lost_category = p_category
  where id = p_opp;
end;
$$;

-- Cancelación técnica: el trabajo aceptado no se pudo hacer. Revierte la venta (y devuelve
-- lo cobrado si se pide) sin contarla como pérdida comercial.
create function public.cancelar_trabajo(p_sale uuid, p_reason text, p_refund boolean default true) returns void
language plpgsql set search_path = '' as $$
declare
  v_opp uuid;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'Indicá por qué no se pudo hacer el trabajo'; end if;
  select opportunity_id into v_opp from public.sales where id = p_sale;
  if v_opp is null then raise exception 'Venta no encontrada'; end if;
  perform public.revertir_venta(p_sale, 'Cancelación técnica: ' || p_reason, p_refund);
  update public.opportunities
  set lost_category = 'cancelacion_tecnica', lost_reason = 'Cancelación técnica: ' || p_reason
  where id = v_opp;
end;
$$;

-- ───────────────────────── Funciones: ingestión ─────────────────────────

-- Prepara las filas de un lote: calcula su id externo y busca coincidencias.
-- p_rows: [{row, raw, data, external_id?}]. Nada se crea todavía.
create function public.preparar_lote(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  imp public.data_imports;
  r jsonb;
  d jsonb;
  fp text;
  seen jsonb := '{}';
  ext text;
  v_status text;
  v_reason text;
  v_entity text;
  v_match uuid;
  v_phone_contact uuid;
  v_count int;
  m record;
begin
  select * into imp from public.data_imports where id = p_import for update;
  if not found then raise exception 'Importación no encontrada'; end if;
  if imp.status <> 'preparada' then raise exception 'Este lote ya se aplicó'; end if;
  if imp.kind not in ('ventas', 'oportunidades', 'consultas') then raise exception 'Tipo de lote no soportado'; end if;
  delete from public.ingestion_rows where import_id = p_import;

  for r in select * from jsonb_array_elements(p_rows) loop
    d := r -> 'data';
    v_status := 'nueva'; v_reason := null; v_entity := null; v_match := null; v_phone_contact := null;

    if imp.kind = 'consultas' then
      ext := 'dia:' || (d ->> 'fecha');
    else
      fp := md5(concat_ws('|',
        left(d ->> 'fecha', 10),
        d ->> 'monto', d ->> 'moneda', d ->> 'telefono',
        lower(trim(coalesce(d ->> 'descripcion', d ->> 'necesidad', ''))), lower(trim(coalesce(d ->> 'cliente', '')))));
      -- Filas idénticas en el mismo lote son legítimas (dos ventas iguales el mismo día): se numeran.
      seen := jsonb_set(seen, array[fp], to_jsonb(coalesce((seen ->> fp)::int, 0) + 1));
      ext := coalesce('id:' || nullif(trim(r ->> 'external_id'), ''), 'fp:' || fp || '#' || (seen ->> fp));
    end if;

    if nullif(d ->> 'telefono', '') is not null then
      select contact_id into v_phone_contact from public.contact_phones
      where business_id = imp.business_id and phone_e164 = d ->> 'telefono';
    end if;

    if imp.kind = 'consultas' then
      select t.id, t.count into v_match, v_count from public.inquiry_tallies t
      where t.business_id = imp.business_id and t.date = (d ->> 'fecha')::date and t.method = 'importado';
      if v_match is not null then
        v_entity := 'tally';
        if v_count = (d ->> 'consultas')::int then
          v_status := 'duplicada'; v_reason := 'Ese día ya tiene el mismo total importado';
        else
          v_status := 'dudosa'; v_reason := format('Ese día ya tiene %s consultas importadas (este archivo dice %s)', v_count, d ->> 'consultas');
        end if;
      end if;
    else
      select x.entity_id into v_match from public.external_refs x
      where x.business_id = imp.business_id and x.source_system = imp.source_system
        and x.entity = case when imp.kind = 'ventas' then 'sale' else 'opportunity' end and x.external_id = ext;
      if v_match is not null then
        v_status := 'duplicada'; v_entity := case when imp.kind = 'ventas' then 'sale' else 'opportunity' end;
        v_reason := 'Esta fila ya se importó de esta misma fuente';
      elsif imp.kind = 'ventas' then
        -- Venta parecida ya cargada (a mano o de otra fuente).
        select s.id, s.won_at, s.amount into m from public.sales s
        where s.business_id = imp.business_id and s.status = 'vigente'
          and s.amount = (d ->> 'monto')::bigint and s.currency = d ->> 'moneda'
          and abs(extract(epoch from s.won_at - (d ->> 'fecha')::timestamptz)) <= 2 * 86400
          and (v_phone_contact is null or s.contact_id = v_phone_contact
               or not exists (select 1 from public.contact_phones p where p.contact_id = s.contact_id))
          and not exists (select 1 from public.external_refs x where x.entity = 'sale' and x.entity_id = s.id
                          and x.source_system = imp.source_system)
        order by abs(extract(epoch from s.won_at - (d ->> 'fecha')::timestamptz)) limit 1;
        if m.id is not null then
          v_status := 'dudosa'; v_entity := 'sale'; v_match := m.id;
          v_reason := format('Ya hay una venta del mismo monto el %s', to_char(m.won_at, 'DD/MM'));
        elsif v_phone_contact is not null then
          -- Consulta abierta del mismo cliente: puede ser la venta de esa consulta.
          select o.id, o.created_at into m from public.opportunities o
          where o.contact_id = v_phone_contact and o.entry_kind = 'consulta'
            and o.stage in ('nueva_consulta', 'presupuestado', 'en_seguimiento', 'senado')
            and o.created_at <= (d ->> 'fecha')::timestamptz + interval '1 day'
          order by o.created_at desc limit 1;
          if m.id is not null then
            v_status := 'dudosa'; v_entity := 'opportunity'; v_match := m.id;
            v_reason := format('El cliente tiene una consulta abierta del %s: ¿es la venta de esa consulta?', to_char(m.created_at, 'DD/MM'));
          end if;
        end if;
      elsif v_phone_contact is not null then
        select o.id, o.created_at into m from public.opportunities o
        where o.contact_id = v_phone_contact and o.entry_kind = 'consulta'
          and o.stage in ('nueva_consulta', 'presupuestado', 'en_seguimiento', 'senado')
        order by o.created_at desc limit 1;
        if m.id is not null then
          v_status := 'dudosa'; v_entity := 'opportunity'; v_match := m.id;
          v_reason := format('El cliente ya tiene una consulta abierta del %s', to_char(m.created_at, 'DD/MM'));
        end if;
      end if;
    end if;

    insert into public.ingestion_rows (business_id, import_id, row_number, raw, data, external_id, status, match_reason, match_entity, match_id)
    values (imp.business_id, p_import, (r ->> 'row')::int, r -> 'raw', d, ext, v_status, v_reason, v_entity, v_match);
  end loop;

  update public.data_imports set
    rows_total = (select count(*) from public.ingestion_rows where import_id = p_import),
    rows_duplicate = (select count(*) from public.ingestion_rows where import_id = p_import and status = 'duplicada'),
    rows_review = (select count(*) from public.ingestion_rows where import_id = p_import and status = 'dudosa')
  where id = p_import;
  return (select jsonb_object_agg(status, n) from (
    select status, count(*) n from public.ingestion_rows where import_id = p_import group by status) s);
end;
$$;

-- Crea el registro de una fila y su referencia externa.
create function app.apply_row(p_row uuid) returns void
language plpgsql set search_path = '' as $$
declare
  w public.ingestion_rows;
  imp public.data_imports;
  d jsonb;
  v_sale uuid;
  v_opp uuid;
  v_tally uuid;
  v_funnel uuid;
begin
  select * into w from public.ingestion_rows where id = p_row for update;
  select * into imp from public.data_imports where id = w.import_id;
  d := w.data;
  v_funnel := nullif(d ->> 'embudo', '')::uuid;
  if imp.kind = 'ventas' then
    v_sale := public.registrar_venta_rapida(
      imp.business_id, (d ->> 'monto')::bigint, d ->> 'moneda',
      coalesce((d ->> 'cobrado')::bigint, (d ->> 'monto')::bigint),
      d ->> 'descripcion', d ->> 'cliente', d ->> 'telefono', (d ->> 'costo')::bigint,
      'desconocido', (d ->> 'fecha')::timestamptz, v_funnel, true);
    update public.opportunities set import_id = imp.id where id = (select opportunity_id from public.sales where id = v_sale);
    update public.ingestion_rows set status = 'aplicada', target_entity = 'sale', target_id = v_sale where id = p_row;
    insert into public.external_refs (business_id, source_system, entity, external_id, entity_id, import_id)
    values (imp.business_id, imp.source_system, 'sale', w.external_id, v_sale, imp.id) on conflict do nothing;
  elsif imp.kind = 'oportunidades' then
    v_opp := public.crear_oportunidad(
      imp.business_id, d ->> 'necesidad', d ->> 'cliente', d ->> 'telefono', 'desconocido',
      (d ->> 'fecha')::timestamptz, null, v_funnel, 'declarada', d ->> 'evidencia');
    update public.opportunities set import_id = imp.id where id = v_opp;
    update public.ingestion_rows set status = 'aplicada', target_entity = 'opportunity', target_id = v_opp where id = p_row;
    insert into public.external_refs (business_id, source_system, entity, external_id, entity_id, import_id)
    values (imp.business_id, imp.source_system, 'opportunity', w.external_id, v_opp, imp.id) on conflict do nothing;
  else
    insert into public.inquiry_tallies (business_id, date, count, method, import_id)
    values (imp.business_id, (d ->> 'fecha')::date, (d ->> 'consultas')::int, 'importado', imp.id)
    on conflict (business_id, date, method) do update set count = excluded.count, import_id = excluded.import_id, loaded_at = now()
    returning id into v_tally;
    update public.ingestion_rows set status = 'aplicada', target_entity = 'tally', target_id = v_tally where id = p_row;
  end if;
end;
$$;

-- Aplica las filas nuevas. Las dudosas quedan para revisar; las duplicadas se omiten.
create function public.aplicar_lote(p_import uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  imp public.data_imports;
  w record;
  n int := 0;
begin
  select * into imp from public.data_imports where id = p_import for update;
  if not found then raise exception 'Importación no encontrada'; end if;
  if imp.status <> 'preparada' then raise exception 'Este lote ya se aplicó'; end if;
  for w in select id from public.ingestion_rows where import_id = p_import and status = 'nueva' order by row_number loop
    perform app.apply_row(w.id);
    n := n + 1;
  end loop;
  update public.data_imports set status = 'aplicada', rows_imported = n where id = p_import;
  if imp.source_id is not null then
    update public.data_sources set last_synced_at = now(), last_import_id = p_import, last_error = null where id = imp.source_id;
  end if;
  return jsonb_build_object('aplicadas', n, 'duplicadas', imp.rows_duplicate, 'para_revisar', imp.rows_review);
end;
$$;

-- Decisión sobre una fila dudosa: importar igual, es la misma (vincular) o descartar.
-- Vincular una venta a una consulta abierta gana esa consulta con los datos de la fila.
create function public.decidir_fila(p_row uuid, p_decision text) returns void
language plpgsql set search_path = '' as $$
declare
  w public.ingestion_rows;
  imp public.data_imports;
  d jsonb;
  v_sale uuid;
begin
  select * into w from public.ingestion_rows where id = p_row for update;
  if not found then raise exception 'Fila no encontrada'; end if;
  if w.status <> 'dudosa' then raise exception 'Esta fila ya se resolvió'; end if;
  select * into imp from public.data_imports where id = w.import_id;
  if imp.status = 'deshecha' then raise exception 'La importación se deshizo'; end if;
  d := w.data;
  if p_decision = 'importar' then
    perform app.apply_row(p_row);
    update public.data_imports set rows_imported = rows_imported + 1 where id = imp.id;
  elsif p_decision = 'vincular' then
    if w.match_id is null then raise exception 'No hay con qué vincularla'; end if;
    if imp.kind = 'consultas' then
      -- El total que ya estaba se conserva.
      update public.ingestion_rows set status = 'vinculada', target_entity = 'tally', target_id = w.match_id where id = p_row;
    elsif imp.kind = 'ventas' and w.match_entity = 'opportunity' then
      v_sale := public.ganar_oportunidad(
        w.match_id, (d ->> 'monto')::bigint, d ->> 'moneda',
        coalesce((d ->> 'cobrado')::bigint, (d ->> 'monto')::bigint), (d ->> 'costo')::bigint, true, (d ->> 'fecha')::timestamptz);
      update public.ingestion_rows set status = 'vinculada', target_entity = 'sale', target_id = v_sale where id = p_row;
      insert into public.external_refs (business_id, source_system, entity, external_id, entity_id, import_id)
      values (imp.business_id, imp.source_system, 'sale', w.external_id, v_sale, imp.id) on conflict do nothing;
    else
      update public.ingestion_rows set status = 'vinculada', target_entity = w.match_entity, target_id = w.match_id where id = p_row;
      insert into public.external_refs (business_id, source_system, entity, external_id, entity_id, import_id)
      values (imp.business_id, imp.source_system, w.match_entity, w.external_id, w.match_id, imp.id) on conflict do nothing;
    end if;
  elsif p_decision = 'descartar' then
    update public.ingestion_rows set status = 'descartada' where id = p_row;
  else
    raise exception 'Decisión inválida';
  end if;
  update public.ingestion_rows set decided_by = auth.uid(), decided_at = now() where id = p_row;
  update public.data_imports set rows_review = rows_review - 1 where id = imp.id;
end;
$$;

-- Deshacer también quita las referencias externas (así se puede volver a importar) y las
-- ventas creadas al vincular una fila con una consulta abierta, que vuelve a quedar abierta.
create or replace function public.deshacer_importacion(p_import uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v public.data_imports;
  n int := 0;
  linked record;
begin
  select * into v from public.data_imports where id = p_import for update;
  if not found or not app.can_access(v.business_id) then raise exception 'Importación no encontrada'; end if;
  if v.undone_at is not null then raise exception 'La importación ya se deshizo'; end if;

  if v.kind = 'ventas' then
    for linked in
      select s.id, s.opportunity_id from public.ingestion_rows w join public.sales s on s.id = w.target_id
      where w.import_id = p_import and w.status = 'vinculada' and w.target_entity = 'sale' and w.match_entity = 'opportunity'
    loop
      delete from public.payments where sale_id = linked.id;
      delete from public.sale_adjustments where sale_id = linked.id;
      delete from public.sales where id = linked.id;
      update public.opportunities set stage = 'en_seguimiento' where id = linked.opportunity_id;
      n := n + 1;
    end loop;
    create temp table _opps on commit drop as
      select id, contact_id from public.opportunities where import_id = p_import;
    delete from public.payments where opportunity_id in (select id from _opps);
    delete from public.sale_adjustments where sale_id in (select s.id from public.sales s where s.opportunity_id in (select id from _opps));
    delete from public.sales where opportunity_id in (select id from _opps);
    delete from public.quotes where opportunity_id in (select id from _opps);
    delete from public.attribution_touchpoints where opportunity_id in (select id from _opps);
    delete from public.stage_history where opportunity_id in (select id from _opps);
    delete from public.opportunities where id in (select id from _opps);
    n := n + (select count(*) from _opps);
    delete from public.contacts c
    where c.id in (select contact_id from _opps)
      and not exists (select 1 from public.opportunities o where o.contact_id = c.id)
      and not exists (select 1 from public.sales s where s.contact_id = c.id);
  elsif v.kind = 'oportunidades' then
    -- Las consultas que ya se trabajaron (presupuesto, cobro o venta) se conservan.
    create temp table _opps on commit drop as
      select o.id, o.contact_id from public.opportunities o
      where o.import_id = p_import
        and not exists (select 1 from public.sales s where s.opportunity_id = o.id)
        and not exists (select 1 from public.payments p where p.opportunity_id = o.id)
        and not exists (select 1 from public.quotes q where q.opportunity_id = o.id);
    delete from public.attribution_touchpoints where opportunity_id in (select id from _opps);
    delete from public.stage_history where opportunity_id in (select id from _opps);
    update public.prospects set opportunity_id = null where opportunity_id in (select id from _opps);
    delete from public.opportunities where id in (select id from _opps);
    get diagnostics n = row_count;
    delete from public.contacts c
    where c.id in (select contact_id from _opps)
      and not exists (select 1 from public.opportunities o where o.contact_id = c.id)
      and not exists (select 1 from public.sales s where s.contact_id = c.id);
  elsif v.kind = 'consultas' then
    delete from public.inquiry_tallies where import_id = p_import;
    get diagnostics n = row_count;
  elsif v.kind = 'actividad' then
    delete from public.funnel_activities where import_id = p_import;
    get diagnostics n = row_count;
  else
    delete from public.prospects where import_id = p_import and opportunity_id is null;
    get diagnostics n = row_count;
  end if;

  delete from public.external_refs where import_id = p_import;
  update public.ingestion_rows set status = 'descartada' where import_id = p_import and status in ('dudosa', 'nueva');
  update public.data_imports set undone_at = now(), undone_by = auth.uid(), status = 'deshecha' where id = p_import;
  return n;
end;
$$;

-- ───────────────────────── Políticas de acceso ─────────────────────────

alter table public.funnels enable row level security;
create policy "ver" on public.funnels for select to authenticated using (app.can_access(business_id));
-- El alumno activa plantillas; los embudos a medida los crea el mentor.
create policy "crear" on public.funnels for insert to authenticated
  with check (app.can_access(business_id) and (template_key is not null or app.is_mentor()));
create policy "editar" on public.funnels for update to authenticated using (app.can_access(business_id));

alter table public.funnel_versions enable row level security;
create policy "ver" on public.funnel_versions for select to authenticated using (app.can_access(business_id));
create policy "crear" on public.funnel_versions for insert to authenticated
  with check (app.can_access(business_id) and (version = 1 or app.is_mentor()));

do $$
declare t text;
begin
  foreach t in array array['funnel_activities', 'attribution_touchpoints', 'data_sources', 'ingestion_rows', 'external_refs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "ver" on public.%I for select to authenticated using (app.can_access(business_id))', t);
    execute format('create policy "crear" on public.%I for insert to authenticated with check (app.can_access(business_id))', t);
    execute format('create policy "editar" on public.%I for update to authenticated using (app.can_access(business_id))', t);
    execute format('create policy "borrar" on public.%I for delete to authenticated using (app.can_access(business_id))', t);
  end loop;
  -- Sin auditoría en notas y línea de base: la auditoría la puede leer el alumno.
  foreach t in array array['funnels', 'funnel_versions', 'funnel_activities', 'attribution_touchpoints', 'data_sources']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit()', t);
  end loop;
end;
$$;

-- Notas y línea de base: solo el mentor.
alter table public.mentor_notes enable row level security;
create policy "solo mentor" on public.mentor_notes for all to authenticated using (app.is_mentor()) with check (app.is_mentor());
alter table public.business_baselines enable row level security;
create policy "solo mentor" on public.business_baselines for all to authenticated using (app.is_mentor()) with check (app.is_mentor());

revoke execute on function
  public.crear_embudo, public.versionar_embudo, public.cambiar_estado_embudo, public.registrar_actividad_embudo,
  public.asignar_embudo, public.agregar_punto_contacto, public.crear_oportunidad, public.registrar_venta_rapida,
  public.perder_oportunidad, public.cancelar_trabajo, public.preparar_lote, public.aplicar_lote, public.decidir_fila
from public, anon;
grant execute on function
  public.crear_embudo, public.versionar_embudo, public.cambiar_estado_embudo, public.registrar_actividad_embudo,
  public.asignar_embudo, public.agregar_punto_contacto, public.crear_oportunidad, public.registrar_venta_rapida,
  public.perder_oportunidad, public.cancelar_trabajo, public.preparar_lote, public.aplicar_lote, public.decidir_fila
to authenticated;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
