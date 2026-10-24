# Sesión actual — versión visible de la app

Fecha: 24/10/2026. Responsable: Codex.
Solicitud: poder identificar la versión que se está mostrando tras un despliegue.
Rama: `feat/version-visible`, base main `2a23f326c3d6fdb83326359129cd04304a495eaf`.
PR #8 ya fusionado por el propietario. Esta entrega espera revisión; no hacer merge.

## Cambio y alcance

- `next.config.ts`: SHA del commit de Vercel fijado durante la compilación.
- `src/components/app-header.tsx`: identificador corto visible bajo el logo,
  SHA completo en title, alternativas explícitas local/sin identificar.
- Documentos de coordinación actualizados; AGENTS.md intacto.
- No cambios en Supabase, migraciones, configuración productiva, recargas
  automáticas ni funcionalidades de negocio. El indicador identifica código,
  no el estado de la base ni la existencia de una actualización posterior.

## Validación

- TypeScript, ESLint (src y next.config.ts), 72 pruebas de dominio y build con
  Webpack aprobados. Mismo límite de Turbopack del entorno de sesiones anteriores.
- Navegador contra build de producción local: versión exacta y title completo
  con SHA de prueba. Layout con estilos comprobado en servidor de desarrollo,
  pantalla Operaciones a 390 y 1440 px, etiqueta de 10 px y sin overflow horizontal.
  Autenticación local simulada; no se usó una cuenta productiva ni se modificaron registros.
- Diff y enlaces locales comprobados. Sin pruebas nuevas que repliquen este texto.

Siguiente paso: revisar el PR de esta rama. Después del merge/despliegue, el SHA
corto bajo MDM OS permite reconocer la compilación mostrada. Recargar una pestaña
antigua después de guardar cambios. No hay notificación automática de actualizaciones.
El HEAD vigente se resuelve en el PR o con git rev-parse HEAD.

---

# Registro anterior — aplicación productiva V1.4

Fecha: 24/10/2026 (UTC). Responsable: Codex.
Estado: PR #7 fusionado por el propietario; migración productiva aplicada y verificada.

## Autorización y referencias

El propietario autorizó explícitamente aplicar la migración pendiente después de
confirmar el merge. Alcance: migración V1.4 aprobada y verificaciones; no nuevas
funcionalidades, datos ficticios en producción ni modificaciones de Vercel.

- Main verificado: `8f8a59ef2a0709bcb1c265140aba5fd2c946b9cf`.
- Implementación: [PR #7](https://github.com/GutierrezFranco/calculadora/pull/7), fusionado.
- Rama de este relevo: `docs/v14-migracion-productiva`; PR documental independiente.
- Proyecto Supabase: `mdm-os` (`ddjdtoprftxvasajyfzn`), PostgreSQL 17.11.
- Fuente aplicada sin cambios: `supabase/migrations/20261026000000_v14_clientes_operaciones.sql`.
- SHA256 de la fuente: `945f129b698a939fc0c715f8765ab9a9c0137c2d33ff7923908208e732f5812e`.
- Nombre remoto `v14_clientes_operaciones`, versión asignada por MCP `20261024215117`.

## Ejecución y verificaciones

1. Consultados changelog/documentación Supabase, esquema real, índices, historial y
   asesores antes del cambio. Existía V1.3, no `operations` ni RPC nueva. Historial
   remoto vacío, por instalación anterior fuera del registro de migraciones.
2. Clientes, ventas, pagos y oportunidades tenían cero filas. No se extrajeron
   datos personales ni se crearon fixtures o cuentas de prueba en producción.
3. Aplicada únicamente la migración aprobada desde origin/main con `apply_migration`.
   Respuesta: `success: true`. Sin reset, reinstalación integral ni otras migraciones.
4. Comprobados tabla/RPC, RLS activo, políticas SELECT/INSERT/UPDATE para autenticados,
   permisos de lectura/ejecución, RPC denegada a anon, índice único por operación y
   retiro del anterior por oportunidad. Trigger de inmutabilidad de pagos habilitado.
   Conteos posteriores: clientes/ventas/pagos/operaciones siguen en cero.
5. Consultado historial: una sola entrada V1.4. No aplicar nuevamente ni ejecutar
   db push hasta conciliar historial remoto vs nombres/versiones del repositorio.
6. GitHub confirma deployment Vercel exitoso para el SHA fusionado. La API Vercel
   del conector devolvió 403 por falta de acceso al equipo; no se modificó su
   configuración ni se crearon despliegues. No se verificó sesión productiva.
7. Asesores después del cambio: mismas advertencias preexistentes, ninguna nueva:
   dos RPC SECURITY DEFINER accesibles para usuarios autenticados y protección de
   contraseñas filtradas deshabilitada. No se cambió Auth ni funciones fuera del alcance.
   Referencias: [funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
   [protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Relevo

Siguiente paso funcional: el propietario entra con su cuenta y prueba Registrar →
cliente → trabajo → Guardar y cargar otra → Operaciones/historial.
No se añadieron datos de Facu ni se ejecutó una carga productiva de prueba.
No iniciar marketing mensual, IA ni WhatsApp sin autorización.

El PR #7 conserva la evidencia local: 72 pruebas de dominio, TypeScript, ESLint,
build Webpack, suite SQL y navegador 390/1440 px con Auth simulado. Sigue pendiente
la suite completa e2e con Supabase Auth real; la aplicación de la migración no la sustituye.
Guía: [clientes-operaciones-v1-4.md](clientes-operaciones-v1-4.md).

Este PR modifica solo documentación. Validaciones: diff --check, enlaces locales y
AGENTS.md intacto; no se repitieron suites de aplicación por este relevo documental.
El SHA de este mismo commit se resuelve en el PR o con git rev-parse HEAD.
