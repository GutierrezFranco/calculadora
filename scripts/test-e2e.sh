#!/usr/bin/env bash
# Pruebas de punta a punta: resetea Supabase local y recorre la app en el navegador.
# Requiere `npx supabase start` y la app corriendo (BASE_URL, por defecto http://localhost:3000).
set -euo pipefail
cd "$(dirname "$0")/.."
npx supabase db reset >/dev/null
sleep 3 # PostgREST recarga el esquema después del reset
node tests/e2e/flujo.mjs
node tests/e2e/pipeline.mjs
node tests/e2e/importar.mjs
node tests/e2e/v1b.mjs
node tests/e2e/v13.mjs
