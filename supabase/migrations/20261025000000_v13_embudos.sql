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
