# MDM OS

Aplicación para que negocios de servicio técnico midan, diagnostiquen y mejoren la captación y conversión de clientes, con un panel de mentor para el programa MDM.

## Estado

V1A y V1B completas. Ver [docs/estado.md](docs/estado.md).

## Documentos

- [Especificación funcional v1.1](docs/especificacion-funcional-v1.1.md): fuente de requisitos.
- [Revisión y decisiones](docs/revision-v1.md): viabilidad, arquitectura, decisiones tomadas y preguntas abiertas.
- [Estado de construcción](docs/estado.md): qué está hecho y qué falta.
- [Puesta en marcha](docs/puesta-en-marcha.md): cómo publicarla con Supabase y Vercel.

## Estructura

- `src/domain/`: reglas comerciales y cálculo de métricas, sin dependencias de pantalla ni base de datos.
- `src/app/`: pantallas (Next.js): login, panel del mentor, dashboard, pipeline, contactos, prospección, marketing, proyección, carga, importación, exportación y configuración.
- `supabase/migrations/`: esquema de base de datos con acceso por negocio y auditoría.
- `tests/db/`: tests de acceso que corren contra un Postgres local.
- `tests/e2e/`: recorridos de punta a punta en el navegador.

## Comandos

```bash
npm install
npm run dev       # app en http://localhost:3000 (demo ficticia en /demo)
npm test          # tests de reglas comerciales
npm run test:db   # tests de acceso (requiere Postgres local con createdb/psql)
npm run test:e2e  # recorridos completos contra Supabase local (ver docs/puesta-en-marcha.md)
npm run lint
npm run build
```
