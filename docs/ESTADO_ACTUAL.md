# Estado actual de MDM OS

Actualizado: 28/10/2026 (America/Buenos_Aires).
Repositorio: `GutierrezFranco/calculadora`.
Base funcional inspeccionada: `main` en `91f48d8ae78a4b1bc6b5974d2aea6e3d9def2f0e`.

Este documento es el índice vigente de decisiones, evidencia y pendientes.
[estado.md](estado.md) conserva el registro histórico de construcción;
[arquitectura-v1-3.md](arquitectura-v1-3.md) describe la base técnica.
[SESION_ACTUAL.md](SESION_ACTUAL.md) registra el trabajo activo.

## 1. Autorización actual

PR #7 fusionado por el propietario y migración productiva autorizada explícitamente
el 24/10/2026 después del merge. Aplicación terminada y verificada; ver sesión.
No se autorizaron marketing mensual, IA, integración WhatsApp ni cambios adicionales.

## 1.1. V1.5 — carga simple y rentabilidad por embudo (rama `claude/carga-simple-embudos`, sin merge)

Pedido explícito del propietario (28/10/2026): que el alumno cargue fácil sus reparaciones y ventas, su
publicidad por embudo y vea solo el reporte de rentabilidad. Campos acordados con Facu:
reparación = cliente (nombre + WhatsApp opcional), equipo en un renglón, reparación en un renglón, costo del
repuesto, cobrado y origen; venta = cliente, artículo, costo, precio, cobrado y origen.

| Área | Implementado | Evidencia |
|---|---|---|
| Carga simple (`/cargar`) | Reparación/venta en una pantalla; reutiliza `guardar_operacion`; en reparación lo cobrado es el precio; fecha (hoy) y estado (hecho) en «Más opciones»; sugiere clientes existentes; «Guardar y cargar otra» | e2e `tests/e2e/carga-simple.mjs` (390/1440 px, Supabase local con Auth real) |
| Origen | Embudos activos + los cuatro de siempre (Conocido/recomendado, Tráfico al perfil, Anuncios a WhatsApp, Anuncios a Instagram) que se activan al elegirlos; «No sé» | e2e |
| Publicidad (`/publicidad`) | Tabla `funnel_months`: inversión y consultas por embudo y mes; corregir reemplaza (único por embudo/mes); vacío = no cargado | SQL `tests/db/v15.test.sql` (unicidad, RLS, embudo ajeno) y e2e |
| Reporte | «Rentabilidad por embudo» en Inicio: invertido, consultas, clientes, tasa de cierre (clientes ÷ consultas), costo por consulta/cliente, facturado, costo, cobrado, **ganancia = facturado − costo − inversión**, rentabilidad = ganancia ÷ inversión, avisos de lo que falta | `src/domain/funnel-profit.test.ts` y e2e |

Decisión del propietario: se llama **ganancia** (sin costos fijos, que vienen después). El indicador anterior
«Ganancia» (venta − costo, sin publicidad) se renombró «Margen sin publicidad» para no mostrar dos ganancias.
Migración `supabase/migrations/20261028000000_v15_carga_simple.sql`: PR #10 fusionado y **aplicada en producción**
(proyecto `mdm-os`) el 28/10/2026 por el propietario desde el SQL Editor, con autorización explícita, usando una
versión equivalente e idempotente (`if not exists` / `drop ... if exists`). Verificación: plantilla `meta_instagram`
presente y RLS activo en `funnel_months`. Al ejecutarse desde el SQL Editor **no quedó registrada** en el historial
de migraciones remoto: no volver a aplicarla ni usar `db push` sin conciliar antes (ver sección 7).

## 2. Estado implementado en la rama de esta entrega

Implementación fusionada en main `8f8a59ef2a0709bcb1c265140aba5fd2c946b9cf`.
Ver [contrato, límites y recorrido de prueba](clientes-operaciones-v1-4.md).

| Área | Implementado | Evidencia |
|---|---|---|
| Carga rápida | Cliente existente/nuevo, WhatsApp opcional, datos parciales, estados separados, guardar y otra | Navegador 390/1440 px con API/base reales locales y Auth simulado |
| Relaciones | Cliente 1:N operaciones, consulta real opcional 1:N operaciones, ventas/pagos reutilizados | Pruebas SQL locales y dominio |
| Historial y correcciones | Ficha de cliente, edición con versión, cobros y cancelaciones por operación, fusión preservada | Navegador y SQL |
| Duplicados/aislamiento | Solicitud idempotente, teléfono/referencia, revisión de similitudes, RLS/FKs por negocio | SQL, compatibilidad V1.3 |
| Importación | Circuito V1.3 conservado, ventas generan operación; cobrado vacío permanece desconocido | Regresión SQL; no importación de datos reales |
| Dashboard/pipeline | Consultas distintas de trabajos, clientes únicos, alertas de datos faltantes; pipeline opcional | 72 pruebas de dominio y navegador de operaciones |
| Producción | Migración V1.4 aplicada al proyecto mdm-os; esquema, permisos e índices verificados | GitHub confirma despliegue Vercel exitoso; no se probó carga real autenticada en producción |

Se utilizó checkout completo con dependencias. TypeScript, ESLint, build con `--webpack` y suite SQL
local ejecutados; ver detalle y limitaciones del entorno en [sesión](SESION_ACTUAL.md).
La suite completa e2e con Supabase Auth real queda pendiente.

## 3. Decisiones funcionales aprobadas de V1.4 — implementación incremental

### 3.1. Entrada simple y dos cargas principales

MDM OS es una capa de inteligencia comercial sobre las herramientas del alumno,
no un CRM obligatorio, ERP ni sistema contable.

Primer ingreso y acceso «Registrar»:
1. **Registrar reparación o venta**.
2. **Cargar resultados de marketing**.
3. Alternativa: **Importar mis datos**.

El pipeline permanece opcional para gestionar oportunidades abiertas.
Mobile-first, pocos campos iniciales, detalles desplegables, ayudas breves,
autocompletado y «Guardar y cargar otra». No repetir usuario, negocio ni
configuración que ya existan en la cuenta. Recordar valores útiles sin arrastrar
importes ni confirmaciones comerciales a otra operación.

### 3.2. Clientes y operaciones

- Reutilizar la ficha de cliente. Elegir existente o crear con nombre/referencia
  y WhatsApp opcional; no exigir teléfono para registrar una operación.
- Un cliente puede tener múltiples reparaciones/ventas. Una consulta comercial
  puede vincularse con varias operaciones cuando es una única intención.
- Ejemplo de aceptación: una persona trae dos teléfonos por una misma consulta:
  **1 cliente, 1 consulta identificada, 2 operaciones**, suma de sus importes.
- Al regresar otro mes conserva su cliente; puede tener otra consulta y trabajos.
- La carga contempla fecha, cliente/referencia, tipo reparación/venta, marca/modelo,
  trabajo/producto, estado comercial, precio acordado, cobrado, costo directo,
  origen y orden opcional, sin mostrar todo como obligatorio.
- Separar estado comercial (pendiente, aceptada/ganada, perdida, cancelada),
  estado operativo/entrega y cobro. Registrar no confirma automáticamente venta.
- Permitir vincular consultas existentes y revisar posibles duplicados.
- La ficha reúne consultas identificadas, oportunidades, operaciones, ventas,
  cobros, devoluciones y cambios relevantes. No duplicar movimientos al mostrarlos.

### 3.3. Marketing y datos agregados

Reutilizar embudos y versiones de V1.3. Los pasos varían por estrategia:
Meta Ads necesita inversión/consultas; orgánico puede registrar piezas publicadas;
prospección, contactos realizados; recomendaciones, consultas.

Guardar períodos anteriores, datos parciales, aproximados y declarados.
Corregir un reporte mediante revisiones, no sumando copias del mismo período.
Los cierres declarados se conservan como observaciones hasta conciliar; no
generan clientes ni ventas individuales ni se agregan a las operaciones importadas.

### 3.4. Tres criterios adicionales aprobados

1. **Origen simple:** nombres comprensibles, embudos del negocio y opción
   **«No sé / Sin atribuir»**. Conservar evidencia y calidad de la atribución.
2. **Históricos incompletos:** campos opcionales desconocidos admitidos; vacíos
   no se convierten en cero, fechas supuestas ni cobros inventados.
3. **Dashboard útil con datos parciales:** mostrar lo disponible y explicar qué
   falta para cada métrica; no exigir completar todo para obtener valor.

### 3.5. Métricas y conciliación

- Distinguir clientes únicos, nuevos adquiridos, consultas y operaciones ganadas.
  Una operación adicional no representa otro cliente.
- No presentar «primera compra registrada» como adquisición real si falta historia.
  La regla técnica de adquisición/origen ante historia incompleta sigue por definir.
- Facturación pactada, cobrado y contribución son distintos. Costos desconocidos
  no son cero. No incluir GIF/gastos fijos en la carga mínima ni llamar ganancia
  neta a una contribución parcial.
- No dividir operaciones por consultas como tasa de cierre de clientes.
  El ratio mensual orientativo y la cohorte identificada llevan nombres distintos.
- Mantener pendientes en el denominador de cohorte. En V1.3 las cancelaciones
  técnicas se excluyen de numerador y denominador y se informan aparte.
  No cambiar fórmulas ni esa convención silenciosamente.
- Clientes únicos globales se calculan por unión de clientes, no sumando embudos.
  La facturación de operaciones se atribuye una sola vez.
- Consultas agregadas no producen contactos ni oportunidades ficticias.
  Totales reportados y registros individuales se comparan; no se suman como
  fuentes independientes sin conciliación.
- Costo por consulta/cliente requiere inversión, resultados, unidades, atribución
  y períodos compatibles. Sin respaldo suficiente: incompleto, no cero.

### 3.6. Preparación de integraciones y exclusiones

Identificador interno del cliente como referencia estable. Teléfono/nombre son
señales, no identidad infalible; normalización, sugerencias, confirmación y
fusiones auditadas dentro del negocio.

El contrato futuro contempla identidades y conversaciones externas vinculables,
aisladas por negocio y cuenta de origen, sin crear consultas a partir de mensajes.
El conector de `GutierrezFranco/ejemplo` se evaluará después; no implementarlo ahora.

IA, lectura WhatsApp y Meta quedan después de esta prioridad.
El roadmap formativo de MDM es un proyecto paralelo; no implementarlo aquí.
Stock, contabilidad integral, caja, sucursales y empleados no integran este alcance.

## 4. Limitaciones conocidas — estado después de la primera etapa

| Limitación | Evidencia | Consecuencia / trabajo pendiente |
|---|---|---|
| Venta única por oportunidad | Corregida: una por operación; consulta admite varias | SQL y métricas actualizados; cobros ambiguos exigen elegir trabajo |
| Venta rápida antigua | Reemplazada en Registrar por operaciones y estados separados | RPC legado conservado para compatibilidad; no usarlo para reparaciones pendientes |
| Cobrado vacío en importación | Corregido en acciones/RPC de ingestión | No se corrigen pagos históricos ya inventados sin evidencia |
| Consulta vacía puede convertirse en cero | `parseTallies` en `src/domain/import.ts` | Diferenciar ausencia y cero antes de aplicar |
| Mapeo por palabras parciales | `guessMapping`: «celular» puede tomar una columna de modelo como teléfono | Validar con encabezados reales y confirmar mapeos |
| Sin interpretación de estado/origen por fila | Tipos y mapeo de importación; embudo elegido para el lote | No importar pendientes como ganadas ni atribuir fuentes mezcladas |
| Fuente genérica «archivo»; referencias no reconcilian cambios | `prepareImport` y deduplicación V1.3 | Diferenciar sistemas y revisar correcciones; probar concurrencia |
| Original de fila incompleto y errores de sync no expuestos | `stageRows` no envía `raw`; `syncSource` usa filas válidas sin presentar errores del parser | Completar trazabilidad y explicar aplicaciones parciales |
| Ficha y selección de cliente | Corregidas en carga rápida y detalle | Identidades externas de WhatsApp quedan pendientes |
| Accesos a contacto | Ficha y edición filtran por negocio e ID | RLS/FKs conservadas; no es auditoría completa del producto |
| Teléfono normalizado de forma básica | `src/lib/phone.ts` | No garantiza equivalencias de todos los formatos; ampliar casos antes de deduplicar |
| Sin reporte mensual completo conectado a resultados | Ingestión admite ventas, oportunidades, totales diarios y prospectos | Incorporar agregados versionados sin fabricar fechas/identidades |
| Demo conserva dashboard anterior | `src/app/demo/page.tsx` y `src/components/dashboard.tsx` | Texto de cierre difiere de cohortes; verificar paridad con app autenticada |
| Publicidad resumida por canal y prorrateo temporal | `computeAds` en `src/domain/sources.ts` | No equivale todavía al costo de adquisición por embudo de V1.4 |
| Deshacer importación elimina registros | `deshacer_importacion` V1.3 | Revisar historial y modificaciones posteriores antes de reutilizar como rollback |

Las filas marcadas corregidas tienen validación local; el resto permanece pendiente.
No equivalen a homologación de producción ni auditoría completa de seguridad.

## 5. Caso de aceptación real y pendientes técnicos

Caso Facu: conservar reparaciones del archivo y reportes de marketing como fuentes
distintas. «Cobrado» no acredita precio pactado; «Entregado» no confirma aceptación;
«Pendiente» no es venta ganada. No sumar cierres reportados a operaciones que podrían
representarlos. Histórico con años/fechas ambiguos requiere revisión.

Los archivos reales y datos personales se mantienen fuera del repositorio.
Pruebas automatizadas con fixtures ficticios o anonimizados.

Persistencia de operaciones y compatibilidad V1.3 implementadas en esta entrega.
Los agregados mensuales y adquisición de clientes nuevos siguen pendientes.
No se cargó el archivo real de Facu ni se inventaron importes.

## 6. Secuencia de trabajo y aceptación

| Orden | Entrega | Estado |
|---|---|---|
| 0 | Protocolo documental y PR de estos tres archivos | PR #6 fusionado |
| 1 | Clientes y operaciones: selección/creación, historial, vínculos 1:N y origen sencillo; históricos parciales | PR #7 fusionado; migración productiva aplicada con autorización |
| 2 | Carga rápida/onboarding, marketing por período, adaptación de importación y dashboard | Diseño aprobado; dividir y autorizar cada incremento |
| Posterior | IA y conectores | Fuera de esta etapa |

Criterios a demostrar durante implementación: una consulta/cliente y dos trabajos;
ningún pago inventado; cancelar/devolver uno no afecta el otro; selección de cliente
y coincidencias sin duplicados; reporte más operaciones no duplica resultados;
historia incompleta rotulada; RLS y FKs por negocio; interfaz a 390 px/escritorio;
regresión de cohortes, monedas, ventas directas y devoluciones.

Para comandos y disciplina de validación, ver [AGENTS.md](../AGENTS.md).
No usar este listado como autorización para empezar esas tareas.

## 7. Historial productivo y precaución para el próximo agente

Aplicada `v14_clientes_operaciones` mediante Supabase MCP el 24/10/2026.
Versión remota asignada: `20261024215117`; archivo fuente aprobado:
`supabase/migrations/20261026000000_v14_clientes_operaciones.sql`.
Antes de esta aplicación el registro remoto estaba vacío aunque V1.3 ya existía.
No volver a ejecutar esta migración ni usar `db push` indiscriminadamente:
el historial remoto y los nombres locales requieren conciliación previa.
No se repararon ni marcaron versiones anteriores en esta sesión.
