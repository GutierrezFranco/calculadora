# Sesión actual — V1.5 aplicada en producción

Fecha: 28/10/2026. Responsable: Claude (Claude Code).
Estado: PR #10 (V1.5 carga simple, publicidad y rentabilidad por embudo) fusionado; base productiva actualizada.

## Producción

- El propietario autorizó explícitamente aplicar la base después del merge.
- Ejecutado por el propietario en Supabase → SQL Editor del proyecto `mdm-os` (esta sesión no tiene conector Supabase):
  versión idempotente de `supabase/migrations/20261028000000_v15_carga_simple.sql`.
- Resultado verificado con la consulta final: `listo · plantilla_instagram = 1 · seguridad_activa = true`.
- No quedó registro en `supabase_migrations.schema_migrations`: conciliar historial antes de cualquier `db push`.
- No se cargaron datos ficticios en producción.

## Siguiente paso

1. El propietario prueba con su cuenta: Cargar → Publicidad → Inicio (tarjeta de rentabilidad) y borra la prueba.
2. Facu carga datos reales; ajustar campos según su uso.
3. Pendientes de producto: estados propios de reparaciones; el indicador «Consultas» del inicio no toma
   todavía las consultas cargadas en Publicidad.
