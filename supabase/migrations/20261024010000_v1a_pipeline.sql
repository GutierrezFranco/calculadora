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
