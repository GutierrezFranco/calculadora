# Sesión actual — V1.4 etapa 1: clientes y operaciones

Fecha: 24/10/2026. Responsable: Codex.
Estado: implementado en rama independiente; pendiente revisión del PR. No hacer merge.

## Alcance autorizado

El propietario confirmó PR #6 aprobado (main verificado: ya fusionado) y autorizó
clientes/operaciones, migración y pruebas locales. No autorizó marketing mensual,
IA, integración/lectura de WhatsApp, merge ni cambios en Supabase/Vercel productivos.

## Referencias

- Repositorio: `GutierrezFranco/calculadora`.
- Rama: `feature/v14-clientes-operaciones`.
- Main verificado al iniciar y antes de entrega:
  `91f48d8ae78a4b1bc6b5974d2aea6e3d9def2f0e` (merge de #6).
- PR: consultar el PR abierto de esta rama contra main; se registrará el enlace al publicar.
- El commit de esta entrega incluye el relevo: resolver su SHA con `git rev-parse HEAD`
  o en el PR; no es posible incluir el SHA de este mismo commit en su contenido.
- Checkout completo y dependencias instaladas; no se tocaron cambios de Claude.

## Trabajo realizado

- Tabla `operations` asociada a contactos existentes, consulta opcional 1:N y
  vínculos a ventas/pagos V1.3. Backfill de ventas sin nuevas consultas.
- RPC transaccional, idempotencia, versiones, comprobaciones de duplicados,
  RLS/FKs por negocio, estados separados y datos desconocidos preservados.
- Registrar con cliente nuevo/existente y detalles opcionales. Guardar y cargar otra;
  listado, edición, historial del cliente, cobros/devoluciones por trabajo.
- Métricas y pipeline adaptados para varias operaciones por consulta, sin duplicar
  consultas, clientes o pagos. Alertas por precio/costo/cobro/fecha desconocidos.
- Importación existente conservada y cobrado vacío corregido. No se importaron
  datos reales. Limitaciones del parser/estados y otros pendientes siguen documentados.
- Bloque Next.js de AGENTS.md conservado íntegro.

Archivos principales: `src/app/negocio/[id]/operaciones/`, `cargar/page.tsx`,
`contactos/`, `pipeline/[opp]/page.tsx`, `src/components/app-header.tsx`,
`src/domain/{operations,metrics,cohort,funnel,funnels,quality,sources,types,import}.ts`,
`src/lib/{data,pipeline-data}.ts`, acciones de carga y preview de importación.
Migración: `supabase/migrations/20261026000000_v14_clientes_operaciones.sql`;
instalador generado con `scripts/build-install-sql.sh`. Pruebas: dominio,
`tests/db/v14.test.sql`, regresión de deshacer importación, `tests/e2e/operaciones.mjs`
y selectores de carga actualizados en e2e V1A/V1.3.

## Validación ejecutada

- `npm test`: 72 pruebas, 11 archivos, aprobados.
- `npx tsc --noEmit`: aprobado.
- `npx eslint src`: aprobado.
- `npm run build -- --webpack`: aprobado. El comando predeterminado con Turbopack
  quedó bloqueado por restricciones de creación de procesos/puertos del entorno;
  no se cambió el bundler predeterminado del proyecto.
- `npm run test:db` sobre PostgreSQL 18.4 local, con herramientas cliente 17:
  suite completa aprobada, instalación vacía, migración sobre datos existentes e
  igualdad del instalador. No usa una base remota.
- SQL verifica 1 cliente/1 consulta/2 trabajos, sin consulta ficticia, históricos
  NULL, reintentos, coincidencias, cancelación/devolución independiente, versiones,
  fusión, importación vs venta manual, cobrado vacío y aislamiento/RLS.
- `node tests/e2e/operaciones.mjs`: aprobado en Chromium 390×900 y 1440×1000,
  con app Next, PostgREST 16.5 y PostgreSQL locales. Auth fue **simulado** por un
  gateway temporal fuera del repo. Prueba cliente nuevo reutilizado, 3 trabajos,
  2 sobre una consulta real, edición, dashboard, historial y sin overflow horizontal.
- `git diff --check`: aprobado. Enlaces locales y bloque Next.js verificados.

Limitación de entorno: `supabase start` no pudo completar descarga/arranque por
límites del registro Docker y espacio del daemon. No se ejecutó la suite completa
`npm run test:e2e` con Supabase Auth real. Los scripts quedan preparados; repetirlos
con Supabase local antes de homologar el flujo integral de autenticación.
Los servicios/herramientas y fixtures de prueba son temporales, ficticios y locales;
no están incluidos en la entrega ni reemplazan configuración de producción.

## Relevo y cómo probar

Guía concreta, contrato y limitaciones: [clientes-operaciones-v1-4.md](clientes-operaciones-v1-4.md).
Estado vigente: [ESTADO_ACTUAL.md](ESTADO_ACTUAL.md).

Siguiente paso: revisar este PR, repetir e2e con Supabase local completo y probar
Registrar → Guardar y cargar otra → Operaciones → Historial del cliente.
No aplicar la migración en producción, no desplegar, no fusionar ni iniciar la
siguiente etapa sin autorización. El siguiente agente debe comprobar el HEAD/PR
real antes de trabajar, leer AGENTS.md y estos documentos.
