-- Al instalar V1.3 sobre datos existentes no se pierde nada y se completan embudo y tipo de entrada.
\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.opportunities) <> 4 or (select count(*) from public.sales) <> 2 then
    raise exception 'FALLÓ: se perdieron datos al migrar';
  end if;
  if (select f.template_key from public.opportunities o join public.funnels f on f.id = o.funnel_id where o.need = 'Pantalla') <> 'instagram_organico'
     or (select attribution_confidence from public.opportunities where need = 'Pantalla') <> 'inferida' then
    raise exception 'FALLÓ: el origen orgánico pasa al embudo Instagram orgánico con confianza inferida';
  end if;
  if (select funnel_id from public.opportunities where need = 'Batería') is not null then
    raise exception 'FALLÓ: sin origen queda Sin atribuir';
  end if;
  if (select entry_kind from public.opportunities where need = 'Funda') <> 'venta_directa'
     or (select entry_kind from public.opportunities where need = 'Módulo') <> 'consulta' then
    raise exception 'FALLÓ: la venta rápida anterior pasa a venta directa y la consulta ganada sigue como consulta';
  end if;
  if (select count(*) from public.funnels) <> 2 then
    raise exception 'FALLÓ: se crean solo los embudos de los orígenes usados';
  end if;
end;
$$;
\echo 'Migración sobre datos existentes: ok'
