-- MDM OS · V1.6 · Pedidos surgidos del uso real (04/11/2026). Aditiva.
-- 1) Publicidad en dólares: cada mes guarda la cotización con la que se convierte a la moneda del negocio.
-- 2) Métricas opcionales del anuncio para costo por seguidor y hook rate.
-- 3) Contador de consultas (+1 durante un live): suma de a uno sin pisar lo cargado.
begin;

alter table public.funnel_months
  add column usd_rate numeric(18, 6) check (usd_rate > 0),
  add column followers int check (followers >= 0),
  add column plays_3s int check (plays_3s >= 0),
  add column impressions int check (impressions >= 0);

-- Suma (o resta) consultas del mes de un embudo. Nunca baja de cero. Corre con los permisos del usuario.
create function public.sumar_consulta_embudo(p_business uuid, p_funnel uuid, p_month date, p_delta int default 1) returns int
language plpgsql set search_path = '' as $$
declare
  result int;
begin
  if p_delta not in (-1, 1) then raise exception 'Solo se suma o resta de a una consulta'; end if;
  if extract(day from p_month) <> 1 then raise exception 'Mes inválido'; end if;
  if not exists (select 1 from public.funnels where id = p_funnel and business_id = p_business) then
    raise exception 'Embudo no encontrado';
  end if;
  insert into public.funnel_months (business_id, funnel_id, month, currency, inquiries)
  values (p_business, p_funnel, p_month, (select currency from public.businesses where id = p_business), greatest(p_delta, 0))
  on conflict (business_id, funnel_id, month)
  do update set inquiries = greatest(coalesce(public.funnel_months.inquiries, 0) + p_delta, 0), updated_at = now(), updated_by = auth.uid()
  returning inquiries into result;
  return result;
end;
$$;
revoke execute on function public.sumar_consulta_embudo from public, anon;
grant execute on function public.sumar_consulta_embudo to authenticated;

commit;
