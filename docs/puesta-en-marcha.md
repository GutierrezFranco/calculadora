# Puesta en marcha

Pasos para dejar MDM OS funcionando con tu cuenta de Supabase y Vercel. Se hacen una sola vez.

## 1. Supabase: crear la base

1. En [supabase.com](https://supabase.com), **New project**. Región: São Paulo (`sa-east-1`), la más cercana a Argentina.
2. Entrá a **SQL Editor** → **New query**, pegá todo el contenido de
   [`supabase/migrations/20261024000000_v1a_nucleo.sql`](../supabase/migrations/20261024000000_v1a_nucleo.sql) y tocá **Run**.
   Tiene que terminar con "Success. No rows returned".
3. **Authentication → Sign In / Providers → Email**: dejá activado el login por email y **desactivá "Allow new users to sign up"**.
   Las cuentas de alumnos las creás vos desde el panel del mentor; nadie más se puede registrar.

## 2. Supabase: tu usuario de mentor

1. **Authentication → Users → Add user → Create new user**: tu email y una contraseña, con **Auto Confirm User** marcado.
2. En **SQL Editor**, corré esto con tu email:

   ```sql
   update public.profiles set is_mentor = true
   where id = (select id from auth.users where email = 'TU-EMAIL');
   ```

## 3. Vercel: publicar la app

1. En [vercel.com](https://vercel.com), **Add New → Project** e importá el repo de GitHub.
2. En **Environment Variables** cargá estas tres. Los valores están en Supabase → **Project Settings → API Keys**
   (la URL, en **Project Settings → Data API**):

   | Variable | Dónde está en Supabase |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) |
   | `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`). **Es secreta**: solo en Vercel, nunca en el chat ni en el repo. |

3. **Deploy**. Cuando termine, entrá a la URL que te da Vercel e ingresá con tu usuario de mentor.

## 4. Primer alumno

En **Alumnos → Nuevo alumno** cargá su email, una contraseña inicial y los datos del negocio. Pasale el email y la
contraseña: entra directo a su dashboard.

## Para desarrollo local

```bash
npx supabase start   # Supabase local con Docker; aplica la migración
cp .env.example .env.local   # y completar con los datos que imprime el comando anterior
npm run dev
npm run test:e2e     # prueba completa contra Supabase local (resetear antes con npx supabase db reset)
```
