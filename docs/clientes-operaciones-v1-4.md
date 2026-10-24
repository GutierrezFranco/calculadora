# V1.4 · Primera etapa: clientes y operaciones

## Recorrido para probar (solo ambiente local)

1. Instalar dependencias con `npm ci`. Arrancar Supabase **local**, aplicar allí
   las migraciones (`npx supabase start` y `npx supabase db reset`) y configurar
   `.env.local` con las credenciales de ese entorno. El reset borra la base local.
   No usar claves, URLs ni datos de producción.
2. Ejecutar `npm run dev`, ingresar con una cuenta de prueba y abrir **Registrar**
   (`/negocio/<id>/cargar`). Elegir un cliente por nombre/WhatsApp o **Crear cliente**.
   Para uno nuevo basta nombre o referencia; WhatsApp es opcional.
3. Escribir el trabajo. Fecha, precio y origen pueden desconocerse. La fecha viene
   con el día actual, pero puede borrarse. La operación empieza pendiente de confirmar.
   Seleccionar **Aceptada / ganada** solo cuando se conoce la aceptación comercial.
4. Abrir **Cobros, costos y más detalles** únicamente si hacen falta: cobrado,
   fecha del cobro, costo directo, entrega, marca/modelo, orden o consulta existente.
   Cobrado vacío conserva desconocido; `0` informa que no se cobró.
5. **Guardar y cargar otra** conserva el cliente y la consulta seleccionada,
   fecha y tipo; limpia descripción, importes y confirmación comercial. Una ficha
   recién creada se reutiliza. Para otro cliente usar **Cambiar cliente**.
6. Para probar 1 consulta → 2 trabajos: crear una consulta ficticia desde
   **Más → Oportunidades (opcional)**, seleccionar ese cliente en Registrar,
   elegir la consulta en los detalles y guardar dos trabajos distintos.
7. Abrir **Operaciones** para editar; **Ver historial del cliente** reúne trabajos,
   consultas, ventas originales y movimientos. El dashboard diferencia ventas,
   clientes únicos y consultas. Sin fecha no se asigna una operación a un mes.

## Contrato y compatibilidad

- `contacts.id` es la identidad estable, aislada por negocio. `contact_phones`
  mantiene los teléfonos normalizados. Primer contacto puede quedar sin fecha. Coincidencia exacta de teléfono impide crear
  otra ficha desde carga rápida; coincidencia de nombre requiere revisión y permite
  confirmar personas distintas. El teléfono no implica identidad externa verificada.
- `operations` representa el trabajo, no otro libro de ventas: cliente obligatorio,
  consulta real opcional, descripción, tipo, fecha nullable, marca/modelo/referencia,
  precio/costo nullable, moneda, origen/atribución declarada y versión de edición.
- Estado comercial: pendiente/ganada/perdida/cancelada. Estado operativo:
  sin dato/pendiente/en reparación/entregado. Cobro se deriva de movimientos
  y `payment_known`: desconocido, sin cobrar informado, parcial o completo.
- `sales.operation_id` vincula una venta con un trabajo. Una consulta permite varias
  ventas vigentes, una por operación. Una ganada con fecha y precio conocidos
  utiliza `sales`; sin esos datos se conserva como operación aceptada incompleta.
- `payments.operation_id` identifica el trabajo. Consulta y fecha admiten NULL.
  Cobrado total es acumulado: solo se agrega la diferencia positiva. Reducirlo exige
  devolución; no se reescriben movimientos. Sin fecha no integra caja mensual.
- Request UUID evita duplicar reintentos; versión rechaza ediciones obsoletas;
  referencia única por negocio y aviso por cliente/fecha/precio/trabajo similares.
  Una coincidencia ambigua necesita confirmación explícita.
- La migración proyecta cada venta existente en exactamente una operación.
  V1.3/importación siguen usando ventas/cobros; un trigger crea su operación.
  No se reconstruyen consultas para las operaciones nuevas. Los registros antiguos
  `venta_directa` se conservan por compatibilidad, sin contarlos como consultas.
- La ingestión V1.3 sigue detectando ventas parecidas a las manuales y conserva
  referencias externas. Cobrado vacío ya no se reemplaza por el precio en sus RPC.
- FKs, RLS y validaciones verifican negocio/cliente/consulta/origen. Las fusiones
  conservan trabajos, ventas y teléfonos. Auditoría de cambios y cancelaciones.
- WhatsApp futuro puede referenciar `contact_id`; esta etapa no crea tablas de
  conversaciones, credenciales, conectores ni consultas a partir de mensajes.

## Límites de esta entrega

- El importador de ventas sigue siendo para ventas confirmadas: no interpreta los
  estados de una planilla de reparaciones ni carga pendientes automáticamente.
  No usarlo para importar indiscriminadamente el archivo real de TecnoSOS.
- Coincidencias heurísticas no garantizan identidad: formatos de teléfono no
  equivalentes y referencias ausentes requieren revisión. No hay fusión automática.
- La edición rápida no cambia el cliente ni la consulta ya vinculada. Una venta
  confirmada no permite sobrescribir precio: usar ajustes existentes. Los cobros
  históricos sin fecha se conservan, sin editor de fechas de movimientos en esta etapa.
- Las señas legadas sin trabajo asignado no se reparten entre varias operaciones.
  Puede requerirse conciliación manual antes de calcular saldos precisos.
- No se revierten cobros ficticios de importaciones anteriores automáticamente:
  requieren revisión de su evidencia. Sin fecha/precio/costo el dashboard advierte
  cobertura parcial. No se implementa adquisición de clientes nuevos ni contabilidad.
- Marketing mensual, onboarding completo de tres caminos, IA e integración WhatsApp
  permanecen pendientes. No hay datos reales de Facu en fixtures o repositorio.

## Validación reproducible

- `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npm run build`.
- PostgreSQL local: `npm run test:db` con `createdb`, `psql` y `dropdb` disponibles.
  Comprueba instalación vacía, actualización con datos previos y regresiones V1.3.
- Supabase local + app: `npm run test:e2e` (resetea base local), o
  `node tests/e2e/operaciones.mjs` con `.env.local`. Esta última crea usuario/negocio
  ficticios, o acepta `E2E_OPERATION_BUSINESS`, `E2E_OPERATION_EMAIL`,
  `E2E_OPERATION_PASSWORD` para una cuenta local precreada. Rechaza hosts remotos.
- Evidencia efectivamente ejecutada y limitaciones: [SESION_ACTUAL.md](SESION_ACTUAL.md).
