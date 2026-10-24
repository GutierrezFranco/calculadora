#!/usr/bin/env bash
# Aplica la migración en una base temporal de un Postgres local y corre los tests de acceso.
set -euo pipefail
DB="mdm_os_test_$$"
cd "$(dirname "$0")/.."
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
for f in tests/db/*.test.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
