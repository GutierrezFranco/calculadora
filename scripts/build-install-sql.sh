#!/usr/bin/env bash
# Junta todas las migraciones en un solo archivo para instalar desde el SQL Editor
# de Supabase con un solo copiar, pegar y Run. Correr después de agregar una migración.
set -euo pipefail
cd "$(dirname "$0")/.."
out=supabase/instalar-todo.sql
{
  echo "-- MDM OS · Instalación completa de la base de datos"
  echo "-- Copiá TODO este archivo, pegalo en Supabase → SQL Editor → New query y tocá Run."
  echo "-- Es para un proyecto nuevo y vacío. Generado con scripts/build-install-sql.sh: no editar a mano."
  for f in supabase/migrations/*.sql; do
    echo
    echo "-- ═══════════════ $(basename "$f") ═══════════════"
    echo
    cat "$f"
  done
} > "$out"
echo "Generado $out"
