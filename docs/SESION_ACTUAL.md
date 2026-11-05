# Sesión actual — V1.6 pedidos del uso real

Fecha: 05/11/2026. Responsable: Claude (Claude Code).
Estado: implementado y probado en local; rama `claude/pedidos-uso-real`, PR abierto, sin merge.

## Autorización

El propietario pidió implementar los pedidos surgidos de la llamada con un alumno (04/11) y dejar
pospuestos para mucho más adelante WhatsApp, el análisis de chats con IA y el calendario de contenido.
El plan canje queda como propuesta hasta su aprobación. No autorizó aplicar la migración en producción.

## Archivos

- `supabase/migrations/20261105000000_v16_pedidos_uso_real.sql`, `supabase/instalar-todo.sql` (regenerado).
- `src/domain/funnel-profit.ts` (+ test), `src/lib/profit-data.ts`, `src/components/funnel-profit.tsx`.
- `src/components/amount-input.tsx`, `src/components/refresh-on-focus.tsx`.
- `src/app/negocio/[id]/cargar/` (moneda), `src/app/negocio/[id]/publicidad/` (moneda, +1, datos del anuncio).
- `tests/db/v16.test.sql`, `tests/e2e/v16.mjs`, `tests/e2e/carga-simple.mjs`, `scripts/test-e2e.sh`.
- `docs/ESTADO_ACTUAL.md` §3.6 y §3.7.

## Validaciones ejecutadas (local, datos ficticios)

- `npx vitest run`: 81 pruebas OK. `npx tsc --noEmit` y `npx eslint src tests`: OK.
- `./scripts/test-db.sh` (Postgres 16): todas las suites, incluida V1.6; `instalar-todo.sql` al día.
- `npx next build`: OK.
- Supabase local + `tests/e2e/carga-simple.mjs` y `tests/e2e/v16.mjs` en 390 px: OK.
- No se ejecutó la suite e2e completa anterior.

## Siguiente paso

1. Revisión y merge del propietario.
2. Con autorización: aplicar solo `20261105000000_v16_pedidos_uso_real.sql` en producción (SQL Editor).
3. Decidir la propuesta de plan canje (ESTADO_ACTUAL §3.7).
