#!/usr/bin/env bash
# Aplica las migraciones en una base temporal de un Postgres local y corre los tests de la base.
# También verifica que supabase/instalar-todo.sql esté al día y que instale todo en una base vacía.
set -euo pipefail
DB="mdm_os_test_$$"
cd "$(dirname "$0")/.."
createdb "$DB"
createdb "${DB}_todo"
trap 'dropdb --if-exists "$DB"; dropdb --if-exists "${DB}_todo"' EXIT

psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/db/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
for f in tests/db/*.test.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done

tmp=$(mktemp)
cp supabase/instalar-todo.sql "$tmp"
./scripts/build-install-sql.sh >/dev/null
if ! diff -q "$tmp" supabase/instalar-todo.sql >/dev/null; then
  cp "$tmp" supabase/instalar-todo.sql
  echo "FALLÓ: supabase/instalar-todo.sql está desactualizado: corré scripts/build-install-sql.sh" >&2
  exit 1
fi
psql -q -v ON_ERROR_STOP=1 -d "${DB}_todo" -f tests/db/supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "${DB}_todo" -f supabase/instalar-todo.sql
psql -q -v ON_ERROR_STOP=1 -d "${DB}_todo" -tA -c "
  insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
  insert into auth.users (id) values ('00000000-0000-0000-0000-000000000002');
  do \$\$ begin
    if (select count(*) from public.profiles where is_mentor) <> 1 then raise exception 'FALLÓ: un solo mentor'; end if;
  end \$\$;" >/dev/null
echo "instalar-todo.sql al día e instala todo en una base vacía"
