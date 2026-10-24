# Estado actual de MDM OS

Actualizado: 24/10/2026 (America/Buenos_Aires).
Repositorio: `GutierrezFranco/calculadora`.
Base funcional inspeccionada: `main` en `0487ffcd4c6e11e82abb9d1edda5c6d0b3d70962`.

Este documento es el índice vigente de decisiones, evidencia y pendientes.
[estado.md](estado.md) conserva el registro histórico de construcción;
[arquitectura-v1-3.md](arquitectura-v1-3.md) describe la base técnica.
[SESION_ACTUAL.md](SESION_ACTUAL.md) registra el trabajo activo.

## 1. Autorización actual

El propietario aprobó la dirección funcional y el diseño general de V1.4.
**Solo está autorizada la coordinación documental**: actualizar `AGENTS.md`,
crear este archivo y `docs/SESION_ACTUAL.md`, validar y presentar un PR.

La próxima etapa será clientes y operaciones, pero **no está autorizada su
implementación todavía**. No iniciar código, migraciones o integraciones por
haber sido aprobado el diseño. No hacer merge sin autorización.
Supabase y Vercel productivos permanecen fuera del alcance.

Fuente de las decisiones: aprobación explícita del propietario del 24/10/2026,
después del brief «MDM OS — Rediseño prioritario de la carga de datos (V1.4)».
Este resumen permite el relevo sin depender del acceso a los chats.

## 2. Estado observado y límites de la verificación

| Área | Evidencia en la base inspeccionada | Verificación |
|---|---|---|
| V1A, V1B y V1.3 | Declaradas completas en [estado.md](estado.md); módulos y pruebas presentes | Lectura de código y documentación; suites no ejecutadas en esta sesión |
| GitHub | PR #4 (V1.3) y #5 (menú) fusionados; sin PR abiertos antes de esta tarea | Consulta remota del 24/10/2026 |
| Clientes | `contacts`, `contact_phones`, ficha, búsqueda y fusión manual | Código observado; no validación de producción |
| Carga actual | Consultas diarias y venta rápida, sin necesidad de oportunidad previa en la UI | No resuelve todavía el flujo de operaciones de V1.4 |
| Embudos | Plantillas/versiones, actividad, atribución principal y touchpoints | La migración incluye WhatsApp y perfil Instagram como plantillas distintas |
| Importación | Excel/CSV, selección de hoja, mapeo, lotes, coincidencias y referencias externas | No admite aún el reporte mensual completo de V1.4 |
| Google Sheets | Lectura por enlace compartido y sincronización solicitada por el usuario | Descarga real no probada en esta sesión; sin OAuth |
| Paneles | Inicio autenticado, embudos, mentor, ficha 360°, calidad y cohortes | Código observado; funcionamiento desplegado no homologado |
| Vercel/Supabase activos | Commit desplegado, migraciones aplicadas y configuración activa | No verificados ni modificados en esta sesión |

La existencia de un archivo, pantalla o prueba no demuestra ejecución exitosa.
No hay un checkout completo ni dependencias instaladas para esta tarea; la
inspección y publicación se realizan con el conector GitHub.

## 3. Decisiones funcionales aprobadas de V1.4 — no implementadas

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

## 4. Limitaciones conocidas — siguen presentes en el código

| Limitación | Evidencia | Consecuencia / trabajo pendiente |
|---|---|---|
| Una venta vigente por oportunidad | `sales_one_active_per_opportunity` en migración V1A; funciones de cobro/reversión y `src/lib/pipeline-data.ts` asumen una venta | Adaptar y probar una consulta con varias operaciones, cobros y cancelaciones independientes |
| Venta rápida siempre ganada/completada y cobrado vacío = total | `src/app/negocio/[id]/actions.ts`, carga UI y `registrar_venta_rapida` | No apta todavía para pendientes ni cobros desconocidos de V1.4 |
| Cobrado vacío en importación = monto | `src/domain/import.ts`; `app.apply_row` y `decidir_fila` en migración V1.3 | Puede crear cobros sin evidencia; corregir en etapa autorizada |
| Consulta vacía puede convertirse en cero | `parseTallies` en `src/domain/import.ts` | Diferenciar ausencia y cero antes de aplicar |
| Mapeo por palabras parciales | `guessMapping`: «celular» puede tomar una columna de modelo como teléfono | Validar con encabezados reales y confirmar mapeos |
| Sin interpretación de estado/origen por fila | Tipos y mapeo de importación; embudo elegido para el lote | No importar pendientes como ganadas ni atribuir fuentes mezcladas |
| Fuente genérica «archivo»; referencias no reconcilian cambios | `prepareImport` y deduplicación V1.3 | Diferenciar sistemas y revisar correcciones; probar concurrencia |
| Original de fila incompleto y errores de sync no expuestos | `stageRows` no envía `raw`; `syncSource` usa filas válidas sin presentar errores del parser | Completar trazabilidad y explicar aplicaciones parciales |
| Ficha parcial y selección de cliente ausente en carga rápida | `contactos/[cid]/page.tsx`, `app.contact_for` | Añadir cobros/historial y selección explícita sin duplicar clientes |
| Algunos accesos a contacto solo filtran por su ID | Ficha y acciones de contactos | Validar también negocio de ruta en servidor; probar accesos cruzados |
| Teléfono normalizado de forma básica | `src/lib/phone.ts` | No garantiza equivalencias de todos los formatos; ampliar casos antes de deduplicar |
| Sin reporte mensual completo conectado a resultados | Ingestión admite ventas, oportunidades, totales diarios y prospectos | Incorporar agregados versionados sin fabricar fechas/identidades |
| Demo conserva dashboard anterior | `src/app/demo/page.tsx` y `src/components/dashboard.tsx` | Texto de cierre difiere de cohortes; verificar paridad con app autenticada |
| Publicidad resumida por canal y prorrateo temporal | `computeAds` en `src/domain/sources.ts` | No equivale todavía al costo de adquisición por embudo de V1.4 |
| Deshacer importación elimina registros | `deshacer_importacion` V1.3 | Revisar historial y modificaciones posteriores antes de reutilizar como rollback |

Estas observaciones son de lectura, no una homologación de seguridad completa ni
pruebas ejecutadas. Las correcciones están pendientes; este PR no las aplica.

## 5. Caso de aceptación real y pendientes técnicos

Caso Facu: conservar reparaciones del archivo y reportes de marketing como fuentes
distintas. «Cobrado» no acredita precio pactado; «Entregado» no confirma aceptación;
«Pendiente» no es venta ganada. No sumar cierres reportados a operaciones que podrían
representarlos. Histórico con años/fechas ambiguos requiere revisión.

Los archivos reales y datos personales se mantienen fuera del repositorio.
Pruebas automatizadas con fixtures ficticios o anonimizados.

Antes de la etapa funcional deben concretarse la persistencia de operaciones y
agregados, compatibilidad con relaciones V1.3, cobros/fechas desconocidos, índices,
reglas de corrección e identificación de cliente nuevo. El diseño funcional está
aprobado; no hay DDL, tabla nueva ni contrato SQL implementados por este PR.

## 6. Secuencia de trabajo y aceptación

| Orden | Entrega | Estado |
|---|---|---|
| 0 | Protocolo documental y PR de estos tres archivos | Único trabajo autorizado ahora; ver sesión |
| 1 | Clientes y operaciones: selección/creación, historial, vínculos 1:N y origen sencillo; históricos parciales | Esperar autorización explícita; alcance y pruebas en una rama nueva |
| 2 | Carga rápida/onboarding, marketing por período, adaptación de importación y dashboard | Diseño aprobado; dividir y autorizar cada incremento |
| Posterior | IA y conectores | Fuera de esta etapa |

Criterios a demostrar durante implementación: una consulta/cliente y dos trabajos;
ningún pago inventado; cancelar/devolver uno no afecta el otro; selección de cliente
y coincidencias sin duplicados; reporte más operaciones no duplica resultados;
historia incompleta rotulada; RLS y FKs por negocio; interfaz a 390 px/escritorio;
regresión de cohortes, monedas, ventas directas y devoluciones.

Para comandos y disciplina de validación, ver [AGENTS.md](../AGENTS.md).
No usar este listado como autorización para empezar esas tareas.
