# Estado de construcción

Registro de funciones implementadas y pendientes, como pide la sección 14 de la especificación.

## V1A — Base confiable

| Función | Estado |
|---|---|
| Reglas comerciales (`src/domain`): etapas, ventas, señas, cobros, devoluciones, reversiones | ✅ Hecho, con tests |
| Cálculo de métricas por período (30/60/90 días y personalizado) con "Sin datos" | ✅ Hecho, con tests |
| Base de datos: tablas, aislamiento por negocio, auditoría, historial de etapas | ✅ Migración lista y probada en Postgres local |
| Dashboard del alumno con datos ficticios | ✅ Vista previa sin login |
| Conexión a Supabase y login | ⏳ Siguiente |
| Panel del mentor (listado, activar/desactivar, entrar a un negocio) | ⏳ Pendiente |
| Carga rápida: total diario de consultas, oportunidades, venta rápida, cobros | ⏳ Pendiente |
| Pipeline kanban (escritorio, adaptado a celular) | ⏳ Pendiente |
| Contactos con teléfonos y fusión de duplicados | ⏳ Pendiente (tablas listas) |
| Presupuestos | ⏳ Pendiente (tabla lista) |
| Objetivos | ⏳ Pendiente (tabla lista) |
| Embudo comprimido en el dashboard | ⏳ Pendiente |
| Importación guiada de Excel/CSV | ⏳ Pendiente |
| Exportación | ⏳ Pendiente |
| Configuración del negocio: moneda, cotización, política de señas | ⏳ Pendiente (campos listos) |

## Criterios de aceptación (sección 12)

| # | Criterio | Estado |
|---|---|---|
| 1 | Un contacto, dos necesidades: dos oportunidades | ✅ Test |
| 2 | Misma consulta tres días: una oportunidad | ✅ Test (la pantalla debe ofrecer la oportunidad abierta) |
| 3 | Proveedor o conversación personal: cero consultas | ⏳ Depende de la lectura de WhatsApp (V1C); en carga manual el alumno solo carga consultas calificadas |
| 4 | Seña sin aceptación firme | ✅ Test |
| 5 | Reparación aceptada con anticipo | ✅ Test |
| 6 | Cobro de saldo sin duplicar facturación | ✅ Test |
| 7 | Reversión con devolución | ✅ Test (dominio) y bloqueo en base de datos |
| 8 | La IA no confirma cierres | ✅ Test |
| 9 | Reels con el mismo ángulo no implican origen | ⏳ V1C |
| 10 | Venta con dos ángulos no se duplica | ⏳ V1C |
| 11 | Sin datos ≠ cero | ✅ Test |
| 12 | Aislamiento entre alumnos y rastro del mentor | ✅ Test SQL |
| 13 | 30/60/90 y ventanas equivalentes | ✅ Test |
| 14 | Totales diarios y oportunidades no se duplican | ✅ Test |

## Fuera de V1A

V1B (proyecciones, semáforos, fuentes, prospección, Instagram/Ads manual), V1C (WhatsApp por QR, APIs de Meta, IA con clave Anthropic, ángulos) y V2 (stock, caja, sucursales, empleados).
