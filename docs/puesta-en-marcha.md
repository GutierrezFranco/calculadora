# Puesta en marcha

Pasos para dejar MDM OS funcionando con tu cuenta de Supabase y Vercel. Se hacen una sola vez.

## 1. Supabase: crear la base (un solo copiar y pegar)

1. En [supabase.com](https://supabase.com), **New project**. Región: São Paulo (`sa-east-1`), la más cercana a Argentina.
   Guardá la contraseña de la base que te genera (la app no la usa, pero no se recupera).
2. Abrí [`supabase/instalar-todo.sql`](../supabase/instalar-todo.sql), copiá **todo** el contenido (botón de copiar,
   arriba a la derecha en GitHub), pegalo en Supabase → **SQL Editor → New query** y tocá **Run**.
   Tiene que terminar con "Success. No rows returned".
3. **Authentication → Sign In / Providers → Email**: dejá activado el login por email y **desactivá "Allow new users to sign up"**.

## 2. Supabase: tu usuario de mentor

**Authentication → Users → Add user → Create new user**: tu email y una contraseña, con **Auto Confirm User** marcado.
**El primer usuario que se crea es el mentor**, así que creá el tuyo antes que ningún otro. Los alumnos los creás después
desde la app.

### Si ya tenías la base instalada (actualizaciones)

`instalar-todo.sql` es para un proyecto nuevo. Si tu base ya existe, corré solo los archivos nuevos de
[`supabase/migrations/`](../supabase/migrations/), en orden, de la misma forma (copiar, pegar, Run).

Para pasar a la V1.3 sobre una base que ya tiene datos: corré solo
[`20261025000000_v13_embudos.sql`](../supabase/migrations/20261025000000_v13_embudos.sql). No borra nada: crea los
embudos a partir de los orígenes ya cargados, marca como venta directa las ventas rápidas e importaciones anteriores
y agrega las tablas nuevas. Conviene hacerlo y publicar la app nueva en Vercel el mismo día.

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
npm run build && npm start   # en otra terminal
BASE_URL=http://localhost:3000 npm run test:e2e   # resetea la base local y recorre la app
```
