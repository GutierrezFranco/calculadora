begin;
-- V1.4 etapa 1: una ficha de cliente, varias operaciones, consulta opcional.
-- Los importes monetarios siguen en sales/payments/adjustments; no hay otro libro.
alter table public.contacts alter column first_contact_at drop not null;

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  contact_id uuid not null,
  opportunity_id uuid,
  occurred_at timestamptz,
  kind text not null default 'reparacion' check (kind in ('reparacion','venta')),
  description text not null,
  brand text,
  model text,
  reference text,
  commercial_status text not null default 'pendiente' check (commercial_status in ('pendiente','ganada','perdida','cancelada')),
  work_status text not null default 'sin_dato' check (work_status in ('sin_dato','pendiente','en_trabajo','entregado')),
  agreed_amount bigint check (agreed_amount >= 0),
  currency char(3) not null,
  direct_cost bigint check (direct_cost >= 0),
  payment_known boolean not null default false,
  funnel_id uuid,
  attribution_confidence text check (attribution_confidence in ('declarada','inferida','confirmada')),
  generated_from_sale boolean not null default false,
  request_id uuid not null default gen_random_uuid(),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,id),
  unique (business_id,id,contact_id),
  unique (business_id,request_id),
  foreign key (business_id,contact_id) references public.contacts(business_id,id),
  foreign key (business_id,opportunity_id) references public.opportunities(business_id,id),
  foreign key (business_id,funnel_id) references public.funnels(business_id,id)
);
create index operations_contact on public.operations(business_id,contact_id,occurred_at);
create index operations_inquiry on public.operations(opportunity_id) where opportunity_id is not null;
create unique index operations_reference on public.operations(business_id,reference) where reference is not null;

alter table public.sales add column operation_id uuid;
alter table public.sales alter column opportunity_id drop not null;
alter table public.payments add column operation_id uuid;
alter table public.payments alter column opportunity_id drop not null;
alter table public.payments alter column paid_at drop not null;
-- No inferir fecha del cobro: NULL no participa del flujo de caja de un mes.
alter table public.payments alter column paid_at drop default;
drop index public.sales_one_active_per_opportunity;
create unique index sales_one_active_per_operation on public.sales(operation_id) where status='vigente';

-- Cada venta histórica se representa exactamente una vez; no se crean consultas.
insert into public.operations(id,business_id,contact_id,opportunity_id,occurred_at,description,
  commercial_status,work_status,agreed_amount,currency,direct_cost,payment_known,funnel_id,attribution_confidence,generated_from_sale)
select s.id,s.business_id,s.contact_id,case when o.entry_kind='consulta' then s.opportunity_id end,s.won_at,coalesce(s.description,o.need,'Venta registrada'),
  case when s.status='vigente' then 'ganada' else 'cancelada' end,
  case when o.stage='ganado_completado' then 'entregado' else 'sin_dato' end,
  s.amount,s.currency,s.direct_cost,exists(select 1 from public.payments p where p.sale_id=s.id),o.funnel_id,'inferida',true
from public.sales s left join public.opportunities o on o.id=s.opportunity_id;
update public.sales set operation_id=id;
alter table public.payments disable trigger guard_payment_update;
update public.payments p set operation_id=s.operation_id from public.sales s where s.id=p.sale_id;
alter table public.payments enable trigger guard_payment_update;
alter table public.sales add foreign key(business_id,operation_id,contact_id) references public.operations(business_id,id,contact_id) deferrable initially deferred;
alter table public.payments add foreign key(business_id,operation_id) references public.operations(business_id,id);

alter table public.operations enable row level security;
create policy ver on public.operations for select to authenticated using (app.can_access(business_id));
create policy crear on public.operations for insert to authenticated with check (app.can_access(business_id));
create policy editar on public.operations for update to authenticated using (app.can_access(business_id)) with check (app.can_access(business_id));
grant select,insert,update on public.operations to authenticated;
create trigger audit after insert or update or delete on public.operations for each row execute function app.audit();

-- Validar también los IDs recibidos por RPC y accesos directos a la API.
create function app.guard_operation() returns trigger language plpgsql set search_path='' as $$
declare c public.contacts; o public.opportunities;
begin
 select * into c from public.contacts where id=new.contact_id and business_id=new.business_id;
 if c.id is null or c.merged_into is not null then raise exception 'Seleccioná un cliente vigente de este negocio'; end if;
 if new.opportunity_id is not null then
  select * into o from public.opportunities where id=new.opportunity_id and business_id=new.business_id;
  if o.id is null or o.contact_id<>new.contact_id or o.entry_kind<>'consulta' then raise exception 'La consulta debe pertenecer al mismo cliente y negocio'; end if;
 end if;
 if exists(select 1 from public.sales s where s.operation_id=new.id and s.status='vigente'
           and (new.agreed_amount is distinct from s.amount or new.currency<>s.currency)) then
  raise exception 'El precio de una venta confirmada se corrige con un ajuste, no se sobrescribe';
 end if;
 if tg_op='UPDATE' then
  if new.business_id<>old.business_id then raise exception 'No se mueve una operación entre negocios';end if;
  new.version:=old.version+1;
 end if;
 new.updated_at:=now();return new;
end $$;
create trigger guard_operation before insert or update on public.operations for each row execute function app.guard_operation();

-- La identidad de una venta sigue siendo inmutable, también con consulta opcional.
create or replace function app.guard_sale_update() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.amount is distinct from old.amount or new.currency is distinct from old.currency
 or new.opportunity_id is distinct from old.opportunity_id or new.operation_id is distinct from old.operation_id
 or new.business_id is distinct from old.business_id then
  raise exception 'El monto y la operación de una venta no se editan: registrá un ajuste';
 end if;
 if old.status='revertida' and new.status<>'revertida' then raise exception 'Una venta revertida no vuelve a estar vigente';end if;
 return new;
end $$;

-- Las ventas creadas por V1.3 o por el importador también reciben una operación.
create function app.sale_operation() returns trigger language plpgsql set search_path='' as $$
declare o public.opportunities;
begin
 if new.operation_id is null then
  select * into o from public.opportunities where id=new.opportunity_id;
  insert into public.operations(business_id,contact_id,opportunity_id,occurred_at,description,commercial_status,
    agreed_amount,currency,direct_cost,funnel_id,attribution_confidence,work_status,generated_from_sale)
  values(new.business_id,new.contact_id,case when o.entry_kind='consulta' then o.id end,new.won_at,
    coalesce(new.description,o.need,'Venta registrada'),'ganada',new.amount,new.currency,new.direct_cost,
    o.funnel_id,'inferida',case when o.stage='ganado_completado' then 'entregado' else 'sin_dato' end,true)
  returning id into new.operation_id;
 elsif not exists(select 1 from public.operations op where op.id=new.operation_id and op.business_id=new.business_id
          and op.contact_id=new.contact_id and op.opportunity_id is not distinct from new.opportunity_id) then
  raise exception 'Operación y venta deben pertenecer al mismo cliente y negocio';
 end if;
 return new;
end $$;
create trigger sale_operation before insert on public.sales for each row execute function app.sale_operation();
create function app.payment_operation() returns trigger language plpgsql set search_path='' as $$
declare s public.sales;
begin
 if new.sale_id is not null then
  select * into s from public.sales where id=new.sale_id and business_id=new.business_id;
  if s.id is null then raise exception 'Venta no encontrada'; end if;
  if new.opportunity_id is distinct from s.opportunity_id then raise exception 'El cobro no corresponde a esa consulta';end if;
  if new.operation_id is not null and new.operation_id<>s.operation_id then raise exception 'El cobro pertenece a otra operación'; end if;
  new.operation_id:=s.operation_id;
 elsif new.operation_id is not null and not exists(select 1 from public.operations op where op.id=new.operation_id
   and op.business_id=new.business_id and op.opportunity_id is not distinct from new.opportunity_id) then
  raise exception 'Cobro de otra operación o negocio';
 end if;
 if new.operation_id is not null then
  update public.operations set payment_known=true where id=new.operation_id;
 end if;
 return new;
end $$;
create trigger payment_operation before insert on public.payments for each row execute function app.payment_operation();

-- Reversión y devolución se limitan a ESTA venta, nunca a todos los trabajos de la consulta.
create or replace function public.revertir_venta(p_sale uuid,p_reason text,p_refund boolean default true) returns void
language plpgsql set search_path='' as $$
declare s public.sales; p record;
begin
 if nullif(trim(p_reason),'') is null then raise exception 'Indicá el motivo de la reversión';end if;
 select * into s from public.sales where id=p_sale for update;
 if s.id is null then raise exception 'Venta no encontrada';end if;
 if s.status='revertida' then raise exception 'La venta ya está revertida';end if;
 update public.sales set status='revertida' where id=s.id;
 insert into public.sale_adjustments(business_id,sale_id,kind,amount_delta,currency,reason)
 values(s.business_id,s.id,'anulacion',-s.amount,s.currency,p_reason);
 if p_refund then
  for p in select pay.*,pay.amount-coalesce((select sum(r.amount) from public.payments r where r.refunds_payment_id=pay.id),0) remaining
    from public.payments pay where (pay.sale_id=s.id or pay.operation_id=s.operation_id or (pay.sale_id is null and pay.opportunity_id=s.opportunity_id and not exists(select 1 from public.sales other where other.opportunity_id=s.opportunity_id and other.status='vigente') and (select count(*) from public.operations where opportunity_id=s.opportunity_id)<=1)) and pay.kind<>'devolucion'
  loop
   if p.remaining>0 then insert into public.payments(business_id,opportunity_id,sale_id,operation_id,amount,currency,kind,paid_at,refunds_payment_id,usd_rate)
    values(p.business_id,p.opportunity_id,p.sale_id,p.operation_id,p.remaining,p.currency,'devolucion',now(),p.id,p.usd_rate);end if;
  end loop;
 end if;
 update public.operations set commercial_status='cancelada' where id=s.operation_id;
 if s.opportunity_id is not null and not exists(select 1 from public.sales where opportunity_id=s.opportunity_id and status='vigente') and not exists(select 1 from public.operations where opportunity_id=s.opportunity_id and commercial_status='ganada') then
  update public.opportunities set stage='perdido',lost_at=now(),lost_reason='Venta revertida: '||p_reason where id=s.opportunity_id;
 end if;
end $$;
create or replace function public.cancelar_trabajo(p_sale uuid,p_reason text,p_refund boolean default true) returns void
language plpgsql set search_path='' as $$
declare o uuid;
begin
 select opportunity_id into o from public.sales where id=p_sale;
 perform public.revertir_venta(p_sale,'Cancelación técnica: '||p_reason,p_refund);
 if o is not null and not exists(select 1 from public.sales where opportunity_id=o and status='vigente') and not exists(select 1 from public.operations where opportunity_id=o and commercial_status='ganada') then
  update public.opportunities set lost_category='cancelacion_tecnica' where id=o;
 end if;
end $$;

-- Un cobro sin venta elegida solo es inequívoco si queda una única venta vigente.
create or replace function public.registrar_cobro(p_opp uuid,p_amount bigint,p_currency text,p_method text default null,p_paid_at timestamptz default now()) returns uuid
language plpgsql set search_path='' as $$
declare o public.opportunities; s public.sales; result uuid;
begin
 select * into o from public.opportunities where id=p_opp for update;
 if o.id is null then raise exception 'Oportunidad no encontrada';end if;
 if o.stage='perdido' then raise exception 'La oportunidad está perdida: reabrila antes de cobrar';end if;
 if (select count(*) from public.sales where opportunity_id=p_opp and status='vigente')>1 then
  raise exception 'Hay varios trabajos: registrá el cobro desde la operación correspondiente';
 end if;
 select * into s from public.sales where opportunity_id=p_opp and status='vigente';
 insert into public.payments(business_id,opportunity_id,sale_id,amount,currency,kind,method,paid_at)
 values(o.business_id,p_opp,s.id,p_amount,p_currency,case when s.id is null then 'sena'::app.payment_kind else 'saldo'::app.payment_kind end,p_method,p_paid_at) returning id into result;
 if s.id is null then update public.opportunities set stage='senado' where id=p_opp;end if;
 return result;
end $$;

create function public.guardar_operacion(p_business uuid,p_data jsonb,p_id uuid default null,p_version int default 0) returns uuid
language plpgsql set search_path='' as $$
declare
 refund_row record;
 b public.businesses; op public.operations; c public.contacts; q public.opportunities; s public.sales;
 cid uuid:=nullif(p_data->>'contact_id','')::uuid; phone text:=nullif(trim(p_data->>'phone'),'');
 nm text:=nullif(trim(p_data->>'name'),''); rid uuid:=(p_data->>'request_id')::uuid;
 at_date timestamptz:=nullif(p_data->>'occurred_at','')::timestamptz;
 price bigint:=(p_data->>'agreed_amount')::bigint; cost bigint:=(p_data->>'direct_cost')::bigint;
 paid bigint:=(p_data->>'paid')::bigint; already bigint:=0;
 inquiry uuid:=nullif(p_data->>'opportunity_id','')::uuid;
 funnel uuid:=nullif(p_data->>'funnel_id','')::uuid;
 status text:=p_data->>'commercial_status'; cur text:=p_data->>'currency'; duplicate uuid;
begin
 if not app.can_access(p_business) then raise exception 'Negocio no encontrado';end if;
 select * into b from public.businesses where id=p_business;
 if rid is null then raise exception 'Falta identificador de solicitud';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business::text,0));
 if p_id is null then
  select * into op from public.operations where business_id=p_business and request_id=rid;
  if op.id is not null then return op.id;end if;
 else
  select * into op from public.operations where id=p_id and business_id=p_business for update;
  if op.id is null or op.version<>p_version then raise exception 'La operación cambió: recargá antes de editar';end if;
 end if;
 if cur not in (b.currency,'USD') or cur is null then raise exception 'Moneda inválida';end if;
 if nullif(trim(p_data->>'description'),'') is null or length(p_data->>'description')>500 then raise exception 'Indicá el trabajo o producto (máximo 500 caracteres)';end if;
 if nullif(p_data->>'paid_at','')::timestamptz>now()+interval '1 day' then raise exception 'Fecha de cobro futura';end if;
 if at_date is not null and (at_date at time zone b.timezone)::date>(now() at time zone b.timezone)::date then raise exception 'La fecha no puede ser futura';end if;
 if price<0 or cost<0 or paid<0 or (paid is not null and price is not null and paid>price) then raise exception 'Revisá los importes';end if;
 if phone is not null and phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'WhatsApp inválido';end if;
 if cid is null then
  if nm is null or length(nm)>200 then raise exception 'Indicá nombre o referencia del cliente';end if;
  if exists(select 1 from public.contact_phones where business_id=p_business and phone_e164=phone) then
   raise exception 'Ese WhatsApp ya pertenece a un cliente: buscalo y seleccionalo';
  end if;
  if not coalesce((p_data->>'distinct_client')::boolean,false) and exists(select 1 from public.contacts where business_id=p_business and merged_into is null and lower(trim(name))=lower(nm)) then
   raise exception 'Ya hay un cliente con ese nombre: seleccioná su ficha o confirmá que es otra persona';
  end if;
  insert into public.contacts(business_id,name,first_contact_at) values(p_business,nm,at_date) returning id into cid;
  if phone is not null then insert into public.contact_phones(business_id,contact_id,phone_e164) values(p_business,cid,phone);end if;
 end if;
 select * into c from public.contacts where id=cid and business_id=p_business and merged_into is null;
 if c.id is null then raise exception 'Cliente no encontrado en este negocio';end if;
 if p_id is not null and cid<>op.contact_id then raise exception 'No se cambia el cliente de una operación: revisá la ficha o fusión';end if;
 if inquiry is not null then
  select * into q from public.opportunities where id=inquiry and business_id=p_business and contact_id=cid and entry_kind='consulta';
  if q.id is null then raise exception 'Consulta de otro cliente o negocio';end if;
  if at_date is not null and q.created_at>at_date+interval '1 day' then raise exception 'La operación no puede ser anterior a la consulta vinculada';end if;
 end if;
 if funnel is not null and not exists(select 1 from public.funnels where id=funnel and business_id=p_business) then raise exception 'Origen inválido';end if;
 if p_id is null and not coalesce((p_data->>'distinct_operation')::boolean,false) then
  select id into duplicate from public.operations where business_id=p_business and contact_id=cid
   and ((occurred_at at time zone b.timezone)::date is not distinct from (at_date at time zone b.timezone)::date)
   and (generated_from_sale or (lower(trim(description))=lower(trim(p_data->>'description')) and brand is not distinct from nullif(trim(p_data->>'brand'),'') and model is not distinct from nullif(trim(p_data->>'model'),'')))
   and agreed_amount is not distinct from price and currency=cur limit 1;
  if duplicate is not null then raise exception 'Posible operación duplicada: revisá el historial o confirmá que es otro trabajo';end if;
 end if;
 if p_id is null then
  insert into public.operations(business_id,contact_id,opportunity_id,occurred_at,kind,description,brand,model,reference,
    commercial_status,work_status,agreed_amount,currency,direct_cost,payment_known,funnel_id,attribution_confidence,request_id)
  values(p_business,cid,inquiry,at_date,p_data->>'kind',trim(p_data->>'description'),nullif(trim(p_data->>'brand'),''),nullif(trim(p_data->>'model'),''),nullif(trim(p_data->>'reference'),''),
    status,p_data->>'work_status',price,cur,cost,paid is not null,funnel,case when funnel is not null then 'declarada' end,rid)
  returning * into op;
 else
  if op.opportunity_id is distinct from inquiry then raise exception 'La consulta vinculada no se cambia desde una edición';end if;
  update public.operations set occurred_at=at_date,kind=p_data->>'kind',description=trim(p_data->>'description'),
    brand=nullif(trim(p_data->>'brand'),''),model=nullif(trim(p_data->>'model'),''),reference=nullif(trim(p_data->>'reference'),''),
    work_status=p_data->>'work_status',agreed_amount=price,currency=cur,direct_cost=cost,funnel_id=funnel,
    payment_known=payment_known or paid is not null
  where id=op.id returning * into op;
 end if;
 select * into s from public.sales where operation_id=op.id and sales.status='vigente';
 if status='ganada' and s.id is null and price is not null and at_date is not null then
  insert into public.sales(business_id,operation_id,opportunity_id,contact_id,amount,currency,direct_cost,won_at,description)
  values(p_business,op.id,inquiry,cid,price,cur,cost,at_date,op.description) returning * into s;
 end if;
 if s.id is not null then
  if status in ('pendiente','perdida') then raise exception 'Una venta ganada se cancela con motivo, no se convierte en pendiente o perdida';end if;
  if at_date is null then raise exception 'Una venta fechada conserva su fecha; corregila por otra fecha conocida';end if;
  update public.sales set direct_cost=cost,won_at=at_date where id=s.id;
 end if;
 if paid is not null then
  if exists(select 1 from public.payments where operation_id=op.id and currency<>cur) then raise exception 'Revisá los cobros en otra moneda desde el historial';end if;
  select coalesce(sum(case when kind='devolucion' then -amount else amount end),0) into already from public.payments where operation_id=op.id;
  if paid<already then raise exception 'Para reducir lo cobrado registrá una devolución; no se borra el historial';end if;
  if paid>already then
   insert into public.payments(business_id,operation_id,opportunity_id,sale_id,amount,currency,kind,paid_at)
   values(p_business,op.id,inquiry,s.id,paid-already,cur,case when s.id is null and status<>'ganada' then 'sena'::app.payment_kind else 'saldo'::app.payment_kind end,nullif(p_data->>'paid_at','')::timestamptz);
  end if;
 end if;
 if status='cancelada' and s.id is not null then
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Indicá el motivo de cancelación';end if;
  perform public.cancelar_trabajo(s.id,p_data->>'reason',coalesce((p_data->>'refund')::boolean,false));
 end if;
 if status='cancelada' and s.id is null and coalesce((p_data->>'refund')::boolean,false) then
  if nullif(trim(p_data->>'reason'),'') is null then raise exception 'Indicá el motivo de cancelación';end if;
  for refund_row in select p.*,p.amount-coalesce((select sum(r.amount) from public.payments r where r.refunds_payment_id=p.id),0) remaining
    from public.payments p where p.operation_id=op.id and p.kind<>'devolucion'
  loop
   if refund_row.remaining>0 then insert into public.payments(business_id,operation_id,opportunity_id,amount,currency,kind,paid_at,refunds_payment_id,usd_rate)
    values(p_business,op.id,inquiry,refund_row.remaining,refund_row.currency,'devolucion',now(),refund_row.id,refund_row.usd_rate);end if;
  end loop;
 end if;
 update public.operations set commercial_status=status where id=op.id;
 if status='ganada' and s.id is not null and inquiry is not null then
  update public.opportunities set stage='ganado_en_reparacion',lost_at=null,lost_category=null where id=inquiry;
 end if;
 return op.id;
end $$;
revoke all on function public.guardar_operacion from public,anon;
grant execute on function public.guardar_operacion to authenticated;

-- Una fusión mueve también los trabajos, sin borrar las fichas ni el historial.
create or replace function public.fusionar_contactos(p_keep uuid,p_remove uuid) returns void
language plpgsql set search_path='' as $$
declare k public.contacts; r public.contacts;
begin
 if p_keep=p_remove then raise exception 'Elegí dos contactos distintos';end if;
 select * into k from public.contacts where id=p_keep for update;
 select * into r from public.contacts where id=p_remove for update;
 if k.id is null or r.id is null or k.business_id<>r.business_id then raise exception 'Contactos de negocios distintos o inexistentes';end if;
 if k.merged_into is not null or r.merged_into is not null then raise exception 'Uno de los contactos ya fue fusionado';end if;
 update public.contact_phones set contact_id=p_keep where contact_id=p_remove;
 update public.opportunities set contact_id=p_keep where contact_id=p_remove;
 update public.operations set contact_id=p_keep where contact_id=p_remove;
 update public.sales set contact_id=p_keep where contact_id=p_remove;
 update public.contacts set name=coalesce(k.name,r.name),first_contact_at=least(k.first_contact_at,r.first_contact_at),
 notes=nullif(concat_ws(E'\n',k.notes,r.notes),'') where id=p_keep;
 update public.contacts set merged_into=p_keep where id=p_remove;
end $$;

-- Reversión explícita de un lote legado: quitar solo su proyección, con auditoría.
create function app.cleanup_imported_operation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not app.can_access(old.business_id) then raise exception 'Negocio no encontrado';end if;
 delete from public.operations op where op.id=old.operation_id and op.generated_from_sale
  and not exists(select 1 from public.sales s where s.operation_id=op.id)
  and not exists(select 1 from public.payments p where p.operation_id=op.id);
 return old;
end $$;
revoke all on function app.cleanup_imported_operation() from public,anon;
create trigger cleanup_imported_operation after delete on public.sales for each row execute function app.cleanup_imported_operation();

-- Cobrado faltante en importación conserva desconocido.
create or replace function app.apply_row(p_row uuid) returns void
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
      (d ->> 'cobrado')::bigint,
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

create or replace function public.decidir_fila(p_row uuid, p_decision text) returns void
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
        (d ->> 'cobrado')::bigint, (d ->> 'costo')::bigint, true, (d ->> 'fecha')::timestamptz);
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
commit;
