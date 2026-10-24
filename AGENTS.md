<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Coordinación de agentes — MDM OS

## Producto y alcance

MDM OS ayuda a negocios de servicio técnico y a su mentor a entender captación,
conversión y resultados comerciales sobre los datos que ya tienen. El pipeline es
opcional. No construir un ERP, contabilidad integral ni el roadmap formativo de MDM.

Reutilizar Next.js, TypeScript, Supabase y los módulos de V1.3. No crear otra
arquitectura de clientes, ventas, cobros o ingestión en paralelo.

- Estado y decisiones vigentes: [docs/ESTADO_ACTUAL.md](docs/ESTADO_ACTUAL.md).
- Trabajo y relevo: [docs/SESION_ACTUAL.md](docs/SESION_ACTUAL.md).
- Base funcional: [docs/especificacion-funcional-v1.1.md](docs/especificacion-funcional-v1.1.md)
  y [docs/arquitectura-v1-3.md](docs/arquitectura-v1-3.md).

La última decisión explícita del propietario prevalece sobre documentación previa.
Distinguir decisión aprobada, propuesta técnica, código observado y comportamiento
probado. No resolver contradicciones de producto silenciosamente.

## Antes de trabajar

1. Leer este archivo, estado y sesión; comprobar rama, SHA, cambios locales, últimos
   commits y PR abiertos. Si se trabaja mediante el conector GitHub, comprobar sus
   equivalentes remotos y declarar que no hay un checkout local completo.
2. Revisar los módulos, migraciones y pruebas afectados. Para cambios de código
   Next.js, cumplir el bloque de instrucciones de la versión conservado arriba.
3. Confirmar el alcance autorizado. Aprobar un diseño no autoriza todas sus etapas.
   Continuar sin volver a pedir permiso para pasos ya autorizados; solicitar
   autorización antes de ampliar la tarea o iniciar la siguiente etapa.
4. Usar una rama distinta de `main`. Una tarea tiene un responsable activo y un PR;
   no editar los mismos archivos simultáneamente con otro agente sin coordinación.
5. Preservar cambios ajenos. No usar datos reales, secretos ni producción como
   entorno de pruebas.

## Reglas funcionales que deben preservarse

- Un cliente puede tener varias operaciones; una consulta puede vincularse con
  varias operaciones. Una reparación extra no crea otro cliente ni otra consulta.
- Separar estado comercial, estado operativo/entrega y situación de cobro.
  Pendiente o entregado no confirma por sí solo una venta ganada.
- Separar precio acordado, cobrado, costo directo y contribución. Cobrado vacío es
  desconocido, no pago total ni cero confirmado. No inventar fechas ni importes.
- Conservar datos históricos incompletos y explicar qué falta para calcular
  métricas. No añadir campos obligatorios que no sean necesarios.
- Reutilizar los embudos del negocio con nombres comprensibles y la opción
  «No sé / Sin atribuir». Atribución declarada no equivale a verificación externa.
- Separar agregados reportados de consultas, clientes y operaciones identificadas.
  Los totales no crean personas ni oportunidades ficticias y no se suman a sus
  posibles operaciones de respaldo sin conciliación.
- Mantener clientes únicos, nuevos clientes, consultas y operaciones como métricas
  diferentes. Separar ratio mensual orientativo de conversión por cohorte.
- Reutilizar contactos, referencias e ingestión para evitar duplicados entre carga
  manual e importaciones. Coincidencias ambiguas requieren confirmación.
- Nombre o teléfono no son identidad infalible. Mantener historial, auditoría y
  referencias al fusionar clientes; no adjudicar mensajes como consultas sin
  clasificación y confirmación apropiadas.
- Aislar todas las relaciones y acciones por negocio; validar también el negocio
  de los IDs recibidos. No mezclar monedas sin conversión explícita.
- No borrar silenciosamente ventas, cobros o historial; utilizar ajustes,
  revisiones y devoluciones según el modelo aprobado.

## Validación y autorización

- Documentación: comprobar diff y alcance, enlaces locales, consistencia del
  relevo y conservación íntegra del bloque Next.js. No instalar dependencias
  ni ejecutar suites de aplicación solo por modificar Markdown.
- Código: ejecutar TypeScript, ESLint y pruebas relevantes de dominio; build
  cuando afecte a la aplicación. Para datos, relaciones, RLS o funciones SQL,
  añadir pruebas locales de base y regresión; para flujos, verificar navegador
  en celular (390 px) y escritorio cuando el entorno lo permita.
- Registrar comandos, resultado y entorno. No presentar pruebas inspeccionadas
  como ejecutadas ni controles bloqueados como aprobados.
- No hacer merge sin autorización explícita. No desplegar ni modificar Supabase
  o Vercel productivos sin autorización específica.
- No agregar conectores IA, WhatsApp o Meta dentro de otra tarea. Su implementación
  sigue pospuesta respecto de V1.4; no leer conversaciones en esta etapa.
- No guardar claves, sesiones, datos personales de alumnos/clientes ni archivos
  reales en el repositorio, PR, capturas públicas o logs. Usar ejemplos ficticios
  o anonimizados; respetar autorización y retención de las fuentes.

## Antes de finalizar o cambiar de agente

1. Actualizar [docs/ESTADO_ACTUAL.md](docs/ESTADO_ACTUAL.md) cuando cambie el estado,
   una decisión, una limitación o su verificación. Mantenerlo como índice vigente;
   `docs/estado.md` conserva el registro histórico, no una segunda lista rival.
2. Actualizar siempre [docs/SESION_ACTUAL.md](docs/SESION_ACTUAL.md): responsable,
   tarea, autorización, rama, SHA de referencia, PR, archivos, validaciones,
   límites, bloqueos y siguiente paso exacto.
3. Hacer commit y push de los cambios autorizados y dejar el PR revisable.
   El SHA del propio documento no puede escribirse dentro del mismo commit:
   registrar el último SHA verificado y cómo resolver el HEAD vigente.
4. Informar qué cambió, qué se probó y qué falta. Si falla una herramienta,
   conservar un relevo explícito, sin afirmar que el push o PR se completó.
5. El siguiente agente vuelve a comprobar GitHub y continúa desde la rama y el
   estado reales. Los chats y los cambios locales no se comparten automáticamente.
