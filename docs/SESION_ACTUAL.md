# Sesión actual — V1.5 carga simple y rentabilidad por embudo

Fecha: 28/10/2026. Responsable: Claude (Claude Code).
Estado: implementado y probado en local; rama `claude/carga-simple-embudos`, PR pendiente de crear.

## Autorización

El propietario pidió explícitamente simplificar la carga (campos acordados con Facu), agregar la publicidad
por embudo y el reporte de rentabilidad, y llamar «ganancia» a facturado − costo − inversión.
No autorizó: aplicar la migración en producción, IA, WhatsApp ni otros cambios.

## Archivos

- `supabase/migrations/20261028000000_v15_carga_simple.sql` y `supabase/instalar-todo.sql` (regenerado).
- `src/app/negocio/[id]/cargar/` (página, `simple-form.tsx`, `actions.ts`), `src/app/negocio/[id]/publicidad/`.
- `src/domain/funnel-profit.ts` (+ test), `src/lib/profit-data.ts`, `src/components/funnel-profit.tsx`.
- `src/lib/funnel-choice.ts` (`simpleFunnelOptions`), `src/components/app-header.tsx` (Cargar, Publicidad, Mis trabajos).
- `src/app/negocio/[id]/page.tsx`: reporte arriba; «Margen sin publicidad».
- `tests/db/v15.test.sql`, `tests/e2e/carga-simple.mjs` (agregado a `scripts/test-e2e.sh`).

El formulario completo anterior (`operaciones/operation-form.tsx`) sigue para editar trabajos existentes.

## Validaciones ejecutadas (local, datos ficticios)

- `npx vitest run`: 77 pruebas OK. `npx tsc --noEmit` y `npx eslint src tests`: OK.
- `./scripts/test-db.sh` (Postgres 16 local): todas las suites, incluida V1.5; `instalar-todo.sql` al día.
- `npx next build` (Turbopack): OK. Nota: `next build --webpack` no procesa Tailwind en este proyecto.
- `npx supabase start` (sin studio/edge/logflare/storage/realtime) + app en :3200 + `tests/e2e/carga-simple.mjs`:
  OK en 390 px y 1440 px (dos reparaciones del mismo cliente sin duplicarlo, una venta, publicidad
  corregida sin sumar, tarjeta de Tráfico al perfil con ganancia $15.000 y +50 %).
- No se ejecutó la suite e2e completa anterior.

## Pendiente / siguiente paso

1. Crear el PR desde la rama (el push no se pudo hacer desde esta sesión por permisos del repositorio).
2. Revisión y merge del propietario.
3. Con autorización explícita: aplicar solo la migración V1.5 en `mdm-os` (ver precaución de la sección 7 de
   ESTADO_ACTUAL; no usar `db push`).
4. Pendiente de producto: estados propios del propietario para reparaciones; el indicador «Consultas» del
   inicio todavía no toma las consultas cargadas en Publicidad.
