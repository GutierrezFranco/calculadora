# Estado de construcción

Registro de funciones implementadas y pendientes, como pide la sección 14 de la especificación.

Pruebas:

- `npm test`: reglas comerciales, métricas, embudo e interpretación de planillas (32 tests).
- `npm run test:db`: acceso por negocio y pipeline en la base (Postgres local).
- `npm run test:e2e`: tres recorridos completos en el navegador contra Supabase local (alta y acceso, pipeline, importación y exportación).

## V1A — Base confiable: completa

| Función | Estado |
|---|---|
| Reglas comerciales: etapas, ventas, señas, cobros, devoluciones, reversiones | ✅ |
| Métricas por período (30/60/90 días) con "Sin datos" y comparación con el período anterior | ✅ |
| Base de datos: aislamiento por negocio, auditoría, historial de etapas, ventas y cobros no editables | ✅ |
| Login con email y contraseña, cambio de contraseña | ✅ |
| Panel del mentor: alumnos con métricas, días cargados, alta, activar/desactivar, registro de accesos | ✅ |
| Dashboard del alumno con objetivos del mes y embudo | ✅ |
| Carga rápida: consultas del día y venta rápida | ✅ |
| Pipeline kanban (escritorio y celular) con detalle de oportunidad | ✅ |
| Oportunidades: alta con aviso de oportunidad abierta del mismo cliente | ✅ |
| Presupuestos con versiones, señas, ganar con anticipo, cobro de saldo, completar | ✅ |
| Perder (con o sin devolución de seña), reabrir, revertir venta con devolución | ✅ |
| Costo directo cargable después de la venta | ✅ |
| Próximo seguimiento con aviso en el tablero | ✅ |
| Objetivos mensuales de facturación, ventas y consultas | ✅ |
| Importación guiada de Excel/CSV (ventas y consultas por día) | ✅ |
| Exportación CSV (ventas, oportunidades, cobros, consultas) | ✅ |
| Configuración: moneda, cotización del dólar, política de señas | ✅ |
| Cotización guardada en cada venta y cobro | ✅ |

### Pendiente menor de V1A

- Fusionar contactos duplicados (la tabla lo soporta; falta la pantalla).
- Deshacer una importación completa.
- Que el mentor pueda resetear la contraseña de un alumno desde el panel.

## Criterios de aceptación (sección 12)

| # | Criterio | Estado |
|---|---|---|
| 1 | Un contacto, dos necesidades: dos oportunidades | ✅ Test de dominio y e2e |
| 2 | Misma consulta tres días: una oportunidad | ✅ La pantalla avisa si el cliente ya tiene una abierta (e2e) |
| 3 | Proveedor o conversación personal: cero consultas | ⏳ V1C (lectura de WhatsApp); en carga manual el alumno solo carga consultas calificadas |
| 4 | Seña sin aceptación firme | ✅ Dominio, SQL y e2e |
| 5 | Reparación aceptada con anticipo | ✅ Dominio, SQL y e2e |
| 6 | Cobro de saldo sin duplicar facturación | ✅ Dominio, SQL y e2e |
| 7 | Reversión con devolución | ✅ Dominio, SQL y e2e |
| 8 | La IA no confirma cierres | ✅ Dominio; en la base, ganar y perder solo por acciones del usuario |
| 9 | Reels con el mismo ángulo no implican origen | ⏳ V1C |
| 10 | Venta con dos ángulos no se duplica | ⏳ V1C |
| 11 | Sin datos ≠ cero | ✅ Dominio y e2e |
| 12 | Aislamiento entre alumnos y rastro del mentor | ✅ SQL y e2e |
| 13 | 30/60/90 y ventanas equivalentes | ✅ Dominio |
| 14 | Totales diarios y oportunidades no se duplican | ✅ Dominio (también manual vs. importado) |

## Siguiente: V1B

Proyecciones (ingeniería inversa de objetivos), semáforos con umbrales, análisis por fuente, prospección CSV, snapshots manuales de Instagram/Ads y diagnóstico de cuellos de botella.

## Después: V1C y V2

V1C: WhatsApp por QR (Baileys, como el CRM existente), APIs de Meta, IA con clave Anthropic del alumno, ángulos.
V2: stock, caja, sucursales, empleados.
