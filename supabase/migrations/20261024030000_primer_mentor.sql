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
