-- MDM OS · V1.6 · Plan canje. Aditiva.
-- Un equipo recibido como parte de pago en una venta:
--  * se registra como cobro de esa venta (método «canje»): el precio de la venta queda completo y el saldo es real;
--  * queda en la lista de canjes sin vender, con su valor tomado;
--  * al venderlo, el costo de esa venta es el valor tomado y el canje queda marcado como vendido.
-- No es un módulo de stock: solo los equipos recibidos en canje.
begin;

create table public.trade_ins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  received_operation_id uuid not null,
  payment_id uuid not null references public.payments (id),
  description text not null check (length(description) between 1 and 200),
  value bigint not null check (value > 0),
  currency char(3) not null,
  sold_operation_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, received_operation_id) references public.operations (business_id, id),
  foreign key (business_id, sold_operation_id) references public.operations (business_id, id),
  unique (sold_operation_id)
);
create index on public.trade_ins (business_id) where sold_operation_id is null;

alter table public.trade_ins enable row level security;
create policy "ver" on public.trade_ins for select to authenticated using (app.can_access(business_id));
create trigger audit after insert or update or delete on public.trade_ins for each row execute function app.audit();
grant select on public.trade_ins to authenticated;

-- Equipo recibido en parte de pago de una venta ya guardada.
create function public.registrar_canje(p_business uuid, p_operation uuid, p_description text, p_value bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  op public.operations;
  s public.sales;
  paid bigint;
  pay uuid;
  result uuid;
begin
  if not app.can_access(p_business) then raise exception 'Negocio no encontrado'; end if;
  select * into op from public.operations where id = p_operation and business_id = p_business for update;
  if op.id is null or op.kind <> 'venta' then raise exception 'El canje se registra sobre una venta'; end if;
  if op.commercial_status = 'cancelada' then raise exception 'La venta está cancelada'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Indicá qué equipo recibiste'; end if;
  if p_value is null or p_value <= 0 then raise exception 'Indicá en cuánto tomaste el equipo'; end if;
  select coalesce(sum(case when kind = 'devolucion' then -amount else amount end), 0) into paid
  from public.payments where operation_id = op.id;
  if op.agreed_amount is not null and paid + p_value > op.agreed_amount then
    raise exception 'Lo cobrado más el equipo supera el precio de la venta';
  end if;
  select * into s from public.sales where operation_id = op.id and status = 'vigente';
  insert into public.payments (business_id, operation_id, opportunity_id, sale_id, amount, currency, kind, method, paid_at)
  values (p_business, op.id, op.opportunity_id, s.id, p_value, op.currency, 'saldo', 'canje', op.occurred_at)
  returning id into pay;
  update public.operations set payment_known = true where id = op.id;
  insert into public.trade_ins (business_id, received_operation_id, payment_id, description, value, currency)
  values (p_business, op.id, pay, trim(p_description), p_value, op.currency)
  returning id into result;
  return result;
end;
$$;

-- El equipo de canje se vendió en esta operación: su costo es el valor tomado.
create function public.vender_canje(p_business uuid, p_trade_in uuid, p_operation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.trade_ins;
  op public.operations;
begin
  if not app.can_access(p_business) then raise exception 'Negocio no encontrado'; end if;
  select * into t from public.trade_ins where id = p_trade_in and business_id = p_business for update;
  if t.id is null then raise exception 'Equipo de canje no encontrado'; end if;
  if t.sold_operation_id is not null then raise exception 'Ese equipo de canje ya se vendió'; end if;
  select * into op from public.operations where id = p_operation and business_id = p_business for update;
  if op.id is null or op.kind <> 'venta' then raise exception 'El equipo de canje se vende en una venta'; end if;
  if op.id = t.received_operation_id then raise exception 'Es la misma venta en la que lo recibiste'; end if;
  if op.currency <> t.currency then raise exception 'Cargá la venta en la misma moneda en la que tomaste el equipo'; end if;
  update public.operations set direct_cost = t.value where id = op.id;
  update public.sales set direct_cost = t.value where operation_id = op.id and status = 'vigente';
  update public.trade_ins set sold_operation_id = op.id where id = t.id;
end;
$$;

revoke execute on function public.registrar_canje, public.vender_canje from public, anon;
grant execute on function public.registrar_canje, public.vender_canje to authenticated;

commit;
