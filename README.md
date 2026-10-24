# MDM OS

Aplicación para que negocios de servicio técnico midan, diagnostiquen y mejoren la captación y conversión de clientes, con un panel de mentor para el programa MDM.

## Estado

Construyendo la V1A. Ver [docs/estado.md](docs/estado.md).

## Documentos

- [Especificación funcional v1.1](docs/especificacion-funcional-v1.1.md): fuente de requisitos.
- [Revisión y decisiones](docs/revision-v1.md): viabilidad, arquitectura, decisiones tomadas y preguntas abiertas.
- [Estado de construcción](docs/estado.md): qué está hecho y qué falta.

## Estructura

- `src/domain/`: reglas comerciales y cálculo de métricas, sin dependencias de pantalla ni base de datos.
- `src/app/`: pantallas (Next.js).
- `supabase/migrations/`: esquema de base de datos con acceso por negocio y auditoría.
- `supabase/tests/`: tests de acceso que corren contra un Postgres local.

## Comandos

```bash
npm install
npm run dev       # app en http://localhost:3000 (con datos ficticios)
npm test          # tests de reglas comerciales
npm run test:db   # tests de acceso (requiere Postgres local con createdb/psql)
npm run lint
npm run build
```
