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
