# MDM OS V1.3 — Arquitectura técnica: embudos y panel del mentor

Este documento fija las decisiones de V1.3. La arquitectura no cambia: Next.js en Vercel y Supabase (Postgres con políticas de acceso por negocio). Todo lo nuevo es **aditivo**:

- Se agregan tablas, columnas y funciones.
- No se borra ni se reescribe ningún dato de alumnos.
- Los cambios de comportamiento sobre datos existentes se hacen con reglas explícitas, que quedan documentadas acá.

Migración: `supabase/migrations/20261025000000_v13_embudos.sql`. También está incluida en `supabase/instalar-todo.sql`.

---

## 1. Tasa de cierre por cohortes

Hay dos preguntas distintas y se responden por separado. Nunca se mezclan en un mismo número.

| Medida | Pregunta | Fórmula |
|---|---|---|
| **Cierre de la cohorte** | De las consultas que entraron en el mes M, ¿cuántas terminaron en venta? | ganadas de la cohorte ÷ consultas identificadas de la cohorte |
| **Ventas del mes** | ¿Cuántas ventas se ganaron durante M? | ventas vigentes con fecha de cierre en M |

**Cohorte del mes M.** Son las oportunidades de tipo *consulta* creadas en M.

- Cuenta una venta ganada en cualquier fecha posterior. Por ejemplo, una consulta de marzo ganada en abril cuenta para la cohorte de marzo.
- Las pendientes y las perdidas **están en el denominador**.
- Mientras quedan pendientes, la cohorte se muestra como **abierta** ("puede subir: 12 pendientes").

**Cobertura.** Es la proporción de consultas recibidas que están identificadas, es decir, cargadas como oportunidad:

> consultas identificadas ÷ consultas recibidas

Las consultas recibidas siguen la regla diaria vigente: el total del día manda sobre las oportunidades.

- Una consulta cargada solo como total del día no se puede ganar ni perder, porque no tiene identidad. Por eso no entra en el cálculo del cierre.
- Lo que sí refleja el número es la cobertura. Con cobertura menor al 70 % el cierre se muestra con advertencia.

**Ventas del mes, desglosadas.** El total se separa en tres partes:

1. Ventas de la cohorte del mes.
2. Ventas de cohortes anteriores.
3. Ventas directas (ver §5).

**Qué no cuenta en ninguna de las dos medidas:**

- Las ventas directas: no tienen consulta previa.
- Las cancelaciones técnicas (ver §6).

**Cierre del programa (mentor).** Se calcula como la suma de ganadas de todas las cohortes dividida por la suma de consultas identificadas. No es el promedio de los porcentajes de cada alumno.

Implementación: `src/domain/cohort.ts`. Las funciones son puras y están testeadas.

## 2. Embudos y atribución

### Modelo

- `funnels`: cada estrategia de captación de un negocio.
  - Puede salir de una plantilla o hacerse a medida.
  - Estados: activo, pausado o archivado.
  - Tiene un `channel` que la conecta con el origen histórico (`lead_source`), para que los reportes anteriores sigan funcionando.
- `funnel_versions`: los pasos de **actividad** propios de cada estrategia, guardados en `steps jsonb`. Por ejemplo: lives → horas → espectadores únicos.
  - Cambiar los pasos crea una versión nueva con fecha de inicio.
  - Los datos viejos conservan su versión y no se comparan pasos de versiones distintas.
- `funnel_activities`: los registros de actividad, como un live, una semana de reels o una campaña.
  - Cada registro trae los valores de los pasos de su versión.
  - Cada valor indica si es **real** o **estimado**, y de dónde vino (`manual`, `archivo`, `google_sheets`, `conector`).
- La parte de abajo del embudo es igual para todos y se calcula siempre con los datos comerciales: consultas → oportunidades → clientes → facturación. Así todos los embudos se pueden comparar entre sí.

Las plantillas (Instagram orgánico, Meta Ads → WhatsApp, TikTok orgánico, TikTok Live, Prospección, Recomendaciones, Local / mostrador) están definidas en código, en `src/domain/funnels.ts`. Al activar una, se copian sus pasos a la versión 1.

Los embudos a medida y las versiones nuevas los crea **el mentor**. El alumno puede activar plantillas, pausar y cargar actividad.

### Atribución

- Cada oportunidad tiene **un solo embudo principal** (`opportunities.funnel_id`). La venta lo hereda de su oportunidad, porque no se guarda un embudo propio en la venta. Por eso la suma por embudos da exactamente la facturación del negocio, **sin duplicar clientes ni montos**.
- `funnel_id` vacío significa **Sin atribuir**. Ahí va lo que no tiene origen confiable. Además, la diferencia entre las consultas recibidas y las identificadas se muestra como "consultas sin identificar" dentro de Sin atribuir.
- Cada atribución indica con qué confianza se hizo (`attribution_confidence`):

  | Confianza | Significado |
  |---|---|
  | `confirmada` | Hay evidencia: código, link o dato de un conector. |
  | `declarada` | El cliente lo dijo o el alumno lo eligió. |
  | `inferida` | Surge de una regla o de un dato histórico. |

  También se guardan la evidencia (`source_evidence`), quién atribuyó y cuándo.
- **Puntos de contacto secundarios** (`attribution_touchpoints`):
  - Sirven para registrar algo como "también vio un reel" o "lo recomendó un cliente".
  - Una oportunidad tiene como mucho uno por embudo, y nunca el embudo principal.
  - Se muestran como influencia, **no suman** clientes ni facturación.
- **Clientes únicos.** Un cliente con oportunidades en dos embudos aparece en ambos. Por eso los clientes únicos del negocio se muestran siempre aparte y no son la suma de los embudos. Las operaciones y la facturación sí suman exacto.

### Datos existentes

Al instalar la migración se hace esto:

1. Por cada negocio y cada `source` usado se crea el embudo de plantilla equivalente:
   - organico → Instagram orgánico
   - meta_ads → Meta Ads
   - prospeccion → Prospección
   - referido → Recomendaciones
   - directo → Local / mostrador
2. Se asignan las oportunidades a esos embudos con confianza `inferida` y evidencia "Origen cargado antes de V1.3".
3. Lo que tenía `desconocido` u `otro` queda **Sin atribuir**.

## 3. Ingestión común de datos

MDM OS no reemplaza el sistema de gestión del alumno: lee lo que el alumno ya tiene. Todas las fuentes entran por el mismo circuito:

```
fuente → lote (data_imports) → filas preparadas (ingestion_rows) → coincidencias → aplicar → registros + referencias externas
```

- **Fuentes** (`data_imports.channel`):
  - `manual`
  - `archivo` (Excel o CSV)
  - `google_sheets`
  - `conector` (más adelante: sistema de gestión, WhatsApp, Meta, TikTok)
- **`data_sources`**: fuentes guardadas para volver a sincronizar sin repetir la configuración. Guardan el link, el tipo y el mapeo de columnas.
  - Google Sheets funciona con el link de una planilla compartida "cualquiera con el link". El servidor la descarga como CSV, solo desde `docs.google.com`.
  - No hay OAuth: no se pide acceso a la cuenta de Google.
  - "Sincronizar ahora" trae solo lo nuevo.
- **Filas preparadas** (`ingestion_rows`): cada fila guarda:
  - el dato original (`raw`) y el normalizado;
  - su huella;
  - el resultado de la búsqueda de coincidencias;
  - la decisión que se tomó y quién la tomó;
  - el registro que creó.

  Así **toda cifra se puede rastrear hasta la fila del archivo que la originó**.
- **Referencias externas** (`external_refs`): asocian `(sistema de origen, id externo)` con un registro de MDM OS.
  - El id externo es la columna de ID de la planilla, si existe, por ejemplo el número de orden.
  - Si no existe, se usa la huella de la fila con su número de aparición. Así dos filas idénticas legítimas (dos protectores iguales el mismo día) siguen siendo dos.
- **Deduplicación.** Cada fila recibe un estado:

  | Estado | Cuándo | Qué pasa |
  |---|---|---|
  | `duplicada` | La referencia externa ya existe: es la misma fila de la misma fuente. | Se omite sola. |
  | `dudosa` | Hay una venta parecida (mismo monto, moneda y teléfono, o sin teléfono de un lado, a ±2 días), una consulta abierta del mismo teléfono, o un total diario distinto para ese día. | La revisa el alumno. |
  | `nueva` | Ninguno de los casos anteriores. | Se aplica. |

- **Revisión de dudosas.** El alumno ve las dos filas lado a lado y elige una de tres opciones:
  - **Importar igual.**
  - **Es la misma:** solo vincula la referencia, no crea nada.
  - **Descartar.**

  Al aplicar un lote se importan las nuevas y las dudosas quedan en la cola "Revisar coincidencias", que no bloquea el resto.
- **Deshacer.** `deshacer_importacion` quita lo creado y también las referencias externas del lote, así se puede volver a importar.
- **Tipos que pasan por el circuito:**
  - `ventas`
  - `oportunidades` (consultas individuales con origen)
  - `consultas` (totales por día)

  `prospectos` mantiene su circuito propio, con deduplicación por teléfono, y queda registrado como lote igual.
- **Conectores futuros.** Producen filas normalizadas con `external_id` y llaman a las mismas funciones. Solo hay que escribir el lector, no la lógica de deduplicación.

## 4. Panel del mentor: calidad de datos

Por alumno se muestra:

- **Última actualización.** Se toma de la auditoría y se discrimina por fuente: manual, archivo, Google Sheets y fecha de la última sincronización.
- **Origen de los datos.** Qué parte de las ventas del período vino de cada fuente.
- **Cobertura:**
  - de consultas (identificadas ÷ recibidas);
  - de atribución (con embudo ÷ total);
  - de costos (ventas con costo ÷ ventas).
  - Además, los días con consultas cargadas en el período.
- **Advertencias:**
  - sin cargar hace N días;
  - días sin total de consultas;
  - embudo activo que dejó de cargar actividad;
  - coincidencias sin revisar;
  - ganancia incompleta;
  - muestra chica.
- **Real, estimado o desconocido.** Cada número lleva su marca:
  - **Real:** calculado con registros completos.
  - **Estimado:** el valor se cargó como estimado o el cálculo está incompleto. Por ejemplo, una ganancia con ventas sin costo o actividad marcada estimada.
  - **Desconocido:** no hay datos. Se muestra "Sin datos", nunca cero.

  Implementación: `src/domain/quality.ts`.

**Ficha del alumno.**

- **Línea de base:** el mes de ingreso a MDM, en `businesses.program_start`, lo fija el mentor. Los valores salen de ese mes si hay datos. Si no, el mentor los carga como **declarados** en `business_baselines`, y quedan marcados así.
- **Comparación:** se presenta como "mejora medida", no como causa probada.
- **Notas privadas** (`mentor_notes`): las lee y escribe solo el mentor. El alumno no las ve.
- **Totales del programa:** van siempre separados por moneda, nunca se suman ARS con CLP.

## 5. Ventas directas

`opportunities.entry_kind` toma dos valores: `consulta` o `venta_directa`.

- Una **venta directa** es una venta sin consulta previa registrada. Por ejemplo, alguien que compra en un live de TikTok o un accesorio en el mostrador.
  - **No genera una consulta.** No suma a las consultas del día ni entra en la cohorte. Por eso no altera la tasa de cierre.
  - Sí suma a facturación, clientes y ventas del mes.
- Se muestra aparte:
  - en el embudo, como "ventas directas";
  - en el dashboard, en el desglose de ventas del mes.
- La venta rápida pregunta "¿Vino de una consulta?". Por defecto la respuesta es no, porque es una venta directa.
- **Datos existentes:** una oportunidad cuyo primer estado registrado ya fue "ganado" se creó con venta rápida o por importación. Esas se marcan como `venta_directa`. Las demás quedan como `consulta`.
- Las ventas importadas entran como venta directa, salvo que el alumno las vincule a una consulta al revisar coincidencias.

## 6. Cancelaciones técnicas

`cancelar_trabajo(venta, motivo, devolver)` registra que un trabajo aceptado no se pudo hacer. Por ejemplo: no llegó el repuesto, el equipo no tenía arreglo o se dañó la placa.

- La venta pasa a `revertida`, con un ajuste de anulación, y se devuelve lo cobrado si así se pide. Así se revierten facturación, clientes y ventas.
- La oportunidad queda cerrada con `lost_category = 'cancelacion_tecnica'`. **No cuenta como pérdida comercial**: no aparece en los motivos de pérdida (precio, sin respuesta, eligió a otro) ni en el diagnóstico de seguimiento.
- En la cohorte **sale del numerador y del denominador**. Es neutra: el cierre comercial había ocurrido, pero no hubo venta. Se muestra el conteo aparte ("2 cancelaciones técnicas").
- Las pérdidas comerciales también pasan a tener categoría (`lost_category`): precio, sin respuesta, eligió a otro, no reparable, otro. El motivo en texto libre se conserva.

## 7. Seguridad y acceso

- Todas las tablas nuevas tienen políticas de acceso por negocio (`app.can_access`).
- `mentor_notes` y `business_baselines` las lee y escribe solo el mentor.
- Las funciones nuevas corren con los permisos del usuario, salvo `deshacer_importacion`, que ya corría con permisos elevados y sigue verificando el acceso.
- La descarga de Google Sheets se hace en el servidor y solo acepta `https://docs.google.com/spreadsheets/...`, con límite de tamaño.

## 8. Fuera de esta etapa

- Las integraciones con Meta, TikTok, WhatsApp y Anthropic.
- El acceso a Google con OAuth.
- La detección automática de consultas.

El circuito de ingestión está listo para recibirlas.
