# MDM OS — Especificación funcional v1.0
**Estado:** Documento de producto para iniciar construcción iterativa con Claude Code / Codex.  
**Objetivo:** Medir, diagnosticar y mejorar la captación y conversión de clientes de negocios de servicios técnicos.  
**Alcance:** Una aplicación, una base de datos y módulos progresivos. El roadmap pedagógico, las clases y auditorías educativas quedan en Skool.

## 1. Principios del producto
1. El alumno ve el estado comercial de su negocio y puede profundizar en sus métricas sin perder simplicidad.
2. El alumno no debe registrar dos veces la misma información. Toda acción comercial alimenta las métricas correspondientes.
3. Diferenciar **dato confirmado**, **dato importado**, **dato estimado**, **sugerencia de IA** y **dato faltante**. No convertir ausencia de datos en cero.
4. Priorizar consultas, oportunidades, clientes, ventas, facturación, cobros, contribución económica, fuentes y objetivos. Stock, arqueos, contabilidad integral y gestión operativa de reparaciones no pertenecen a la primera versión.
5. La IA propone y el usuario confirma; no inventa ventas ni cambia pérdidas o importes silenciosamente.
6. Cambios históricos trazables, sin borrados destructivos de ventas o cobros.
7. Privacidad por negocio: alumno solo ve su negocio; mentor puede ver los negocios bajo su programa.

## 2. Roles, acceso y comercialización
- **Alumno/administrador de negocio:** configura y opera un negocio; puede compartir su acceso bajo su responsabilidad en V1, aunque técnicamente se recomienda no compartir credenciales y permitir cuentas separadas en el futuro.
- **Mentor/administrador MDM:** listado de alumnos, agregados, alertas y acceso detallado a sus paneles, con registro de accesos sensibles.
- Inicialmente un negocio por cuenta de alumno. Múltiples sucursales, roles de empleados y jerarquías operativas quedan pospuestos.
- Suscripción de continuidad al finalizar la mentoría; reglas de precio, cobro y período de gracia por definir, configurables.
- Funciones de IA opcionales; cada negocio conecta su propia clave de Anthropic. Almacenar secretos cifrados en servidor, nunca exponerlos en frontend ni logs.

## 3. Entidades y relaciones de datos
### Núcleo
- `business`: nombre, zona, moneda, zona horaria, objetivos, estado.
- `user`, `membership`, `mentor_business_access`: autorización por negocio.
- `contact`: identificador interno, nombre opcional, teléfonos normalizados, canales y fecha primer contacto. Un número puede asociarse a un contacto, pero contemplar correcciones/duplicados.
- `conversation`: contacto, canal (WhatsApp, Instagram, etc.), identificador externo, marcas de tiempo y estado de sincronización. Guardar contenido mínimo necesario y solamente con autorización y base legítima.
- `opportunity`: negocio, contacto, fecha de creación, canal/fuente declarada y evidencia, etapa, motivo, último contacto, fecha cierre.
- `quote`: oportunidad, monto cotizado, moneda, fecha, estado de envío/aceptación y versiones.
- `sale`: oportunidad, monto pactado, costo directo, comisiones variables, fecha ganada, estado (vigente/revertida) y ajustes.
- `payment`: venta u oportunidad, importe, fecha, medio, naturaleza (seña/anticipo/saldo/devolución). Mantener el asiento original y contrapartida de devolución.
- `transaction_adjustment`: cancelaciones, devoluciones totales/parciales y razones.
- `pipeline_stage_history`: etapas y cambios de estado, actor, tiempo.
- `audit_log`: actor, recurso, campo, valor antes/después, fecha, motivo y origen de cambio.
### Adquisición y marketing
- `lead_source`: orgánico, Meta Ads, prospección, referido, directo, desconocido u otros; permitir subfuente y evidencia.
- `prospect`: base de prospección importada con origen, fecha, estado, contacto asociado si se convierte.
- `outreach_event`: primer mensaje, respuesta, interés, seguimiento y oportunidad resultante.
- `content_item`: enlace, plataforma, publicación, tema, ángulo, formato, objetivo y métricas con fecha de observación.
- `content_metric_snapshot`: vistas, alcance, interacciones, retención y otras métricas disponibles, timestamp de medición, fuente y definiciones.
- `account_metric_snapshot`: visitas al perfil, clics al enlace, seguidores y demás métricas agregadas con período y fuente.
- `ad_campaign`, `ad_metric_snapshot`: inversión, conversaciones atribuidas, resultados disponibles y rango.
- `link_click_event`: clic en enlace propio rastreable, fuente y hora; **no equivale a consulta confirmada**.
### Inteligencia y planificación
- `goal`: métrica, valor, período mensual/trimestral, condiciones y fecha de creación.
- `projection_scenario`: ticket, tasas de cierre, costo por consulta, tasas de tráfico, presupuesto y marca de estimado/real.
- `ai_analysis`: conversación analizada, resumen mínimo, problemas expresados, objeciones, frases de clientes, ángulos, estado sugerido, nivel de confianza, versión de prompt, modelo y aprobación.
- `angle`: categoría normalizada y expresiones alternativas.
- `opportunity_angle`: relación muchos-a-muchos entre oportunidad y ángulos, con evidencia. Las agregaciones monetarias deben evitar duplicar ventas al sumar varios ángulos.
- `data_import`: fuente, lote, deduplicación, errores, última sincronización.

## 4. Reglas comerciales
1. **Contacto, conversación, oportunidad, presupuesto, venta y cobro son objetos distintos.** Un contacto puede tener varias oportunidades, y una oportunidad distintos mensajes, presupuestos y pagos.
2. Una consulta calificada es un contacto con intención comercial identificable. Mensajes de proveedores, asuntos personales y spam no se cuentan. La definición configurable debe documentarse; al importar, la IA puede sugerir la categoría.
3. Una consulta nueva se cuenta por **oportunidad nueva**, no por cada mensaje del mismo contacto. Un contacto puede tener dos oportunidades diferentes abiertas. No duplicar la misma intención cuando regresa a escribir.
4. Etapas iniciales estándar: **Nueva consulta → Presupuestado → En seguimiento → Presupuesto aceptado / reservado → Ganado / en reparación → Ganado / completado**; `Perdido` como salida manual confirmada. Una etapa `Señado` opcional no implica por sí misma ganar.
5. `Lo voy a pensar` = en seguimiento, no perdido. Solo el alumno confirma pérdida; IA puede sugerir revisión.
6. **Ganado** significa acuerdo comercial firme y trabajo tomado (por ejemplo, cliente dejó equipo y aceptó reparación), aunque haya saldo pendiente. Una reserva/seña sin compromiso firme no es ganada.
7. Separar monto pactado/venta ganada, cobro real, anticipo/seña, saldo pendiente, costo directo y contribución/margen. Una seña incrementa cobros, no automáticamente ventas ganadas. Una venta ganada con anticipo cuenta una vez en cierres y cobros por los importes realmente recibidos.
8. **Contribución estimada de operación** = venta pactada − costo directo − costos/comisiones variables; no llamarla ganancia neta del negocio sin restar costos generales. Mostrar ganancia declarada o contribución estimada claramente identificada.
9. Devoluciones y anulaciones crean ajustes y pueden revertir una venta, actualizar indicadores y conservar historial. No borrar registros originales ni duplicar el reembolso.
10. Las oportunidades pendientes al final del período no equivalen a pérdidas. Definir tasa de cierre distinguiendo cohortes y cortes temporales: básica `ganadas / (ganadas + perdidas)` para oportunidades decididas, acompañada de `pendientes` y volumen de consultas; mostrar opcionalmente `ganadas / consultas` con definición explícita y horizonte comparable.
11. Fechas y moneda: preservar moneda de origen y zona horaria del negocio. No sumar monedas diferentes sin conversión explícita.
12. Las métricas por ángulo describen **problemas presentes en conversaciones**, no atribución de ventas a reels. Una venta puede relacionarse con varios ángulos; mostrar métricas por ángulo con advertencia de solapamiento y evitar sumarlas como un total aditivo.

## 5. Dashboard del alumno
- Selector global: **últimos 30, 60 y 90 días**, rango personalizado; comparaciones opcionales con período anterior y punto de partida.
- Tarjetas principales: consultas calificadas, clientes/ventas ganadas, facturación comprometida de ventas, dinero cobrado, contribución, tasa de cierre, ticket promedio.
- Secciones expandibles: embudo de ventas, adquisición por canal, contenido e Instagram, anuncios, prospección, análisis de ángulos, tendencias.
- Vista de embudo comprimida: consultas → presupuestos → aceptados → ganados → cobrados; expandir segmento para ver oportunidades, tasas y detalles.
- Semáforos rojo/amarillo/verde se comparan principalmente con metas configuradas para el mismo período y, como referencia adicional, con período anterior. Umbrales editables y sensibles a tamaños de muestra; si faltan datos: `Sin datos`, sin color de fracaso.
- Mostrar origen de cada dato y última actualización.
- No separar en KPIs principales reparación/venta de equipos/accesorios ni cliente nuevo/recurrente; conservar detalle si sirve internamente.

## 6. Ingeniería inversa de objetivos
- Entrada: meta mensual o trimestral de facturación o contribución; ticket promedio (preferentemente real o estimado); tasa de cierre; eventualmente tasa de presupuestado y aceptación; rendimiento por canal.
- Cálculos básicos: ventas requeridas = `ceil(meta facturación / ticket promedio)`; consultas requeridas = `ceil(ventas requeridas / tasa de conversión consulta-a-venta)` cuando la tasa esté bien definida.
- En publicidad: presupuesto estimado = consultas pagas requeridas × costo por consulta calificada; costo por cliente = inversión atribuible / clientes atribuidos. No mezclar consultas de todas las fuentes con gasto publicitario.
- En orgánico: estimar visitas/alcance/reels únicamente cuando existan tasas comparables; distinguir estimación hipotética de proyección respaldada por datos. No prometer que cierto volumen de reels traerá clientes.
- Prospección: contactos requeridos a partir de tasas históricas de respuesta, interés y cierre.
- Permitir escenario principal y alternativo; mostrar supuestos, sensibilidad, metas y brecha respecto a resultados reales.

## 7. Pipeline comercial
- Vista kanban de escritorio, tarjetas por **oportunidad** (no necesariamente por contacto), contacto vinculado, servicio o necesidad, valor, fecha última interacción, próximo seguimiento y estado.
- Edición simple y cambios de etapa auditados.
- En V1 el usuario puede abrir el contacto y, cuando se habilite una integración estable, consultar o responder mensajes; no asumir mensajería integrada desde el inicio.
- Reglas de presupuesto, seña, trabajo aceptado, ganado, finalizado, pérdida manual y reversiones aplicadas automáticamente a métricas.

## 8. Captura de datos e integraciones
- Debe funcionar con **carga manual rápida** o importaciones, sin exigir una integración. Admitir registro diario o semanal por fecha; conservar cuándo se cargó.
- Evitar doble conteo cuando coexisten registros transaccionales y totales agregados. Definir explícitamente el método de alimentación por métrica/período. Por ejemplo, si las oportunidades individuales alimentan las consultas, no sumar además el total manual de consultas para ese período.
- Instagram y Meta Ads: investigar OAuth, permisos, métricas disponibles, límites y renovación de tokens de **APIs oficiales**; fallback manual. No suponer que Insights entrega visitas al perfil atribuibles a cada reel.
- Enlace rastreable en bio: capturar clic antes de redirigir, pero un clic no demuestra que se envió mensaje.
- WhatsApp: objetivo opcional de conexión por QR y lectura automática diaria; **tratar como integración experimental**, sujeto a verificación técnica, seguridad, privacidad y políticas del proveedor. Fallback manual/por conversación seleccionada. No prometer ausencia de bloqueos.
- Procesamiento diario: deduplicar por ID de mensaje, contacto y conversación; distinguir personas, proveedores, spam y clientes; separar nuevas oportunidades de continuaciones; sugerir, nunca confirmar automáticamente cierres o pérdidas.
- Carga de prospectos B2B: importación CSV con estado no contactado, contactado, respondió, interesado, oportunidad, cliente; registrar procedencia de datos y respetar obligaciones de privacidad y antispam.

## 9. IA con clave de Anthropic del alumno
- Funciones opcionales: analizar chat individual, analizar lote/día cuando haya datos accesibles, resumir intención, extraer problemas y lenguaje literal relevante, clasificar objeciones, identificar posibles presupuestos, ventas y oportunidades pendientes, proponer seguimientos y contenidos.
- Resultado estructurado validado por esquema (JSON) y con evidencias, límites de confianza, revisión por alumno y posibilidad de aprobar varias sugerencias.
- No reenviar innecesariamente conversaciones personales, bancarias, médicas o ajenas al negocio. Minimizar retención y proteger datos de terceros. Cada alumno debe autorizar y controlar el procesamiento.
- Clave Anthropic cifrada en servidor y nunca en cliente, registrar consumo aproximado y mostrar costo antes de análisis masivos.
- La venta/ganancia confirmada por alumno se vincula a oportunidad y ángulos; no asignar automáticamente origen desde un reel por coincidencia temática.

## 10. Panel de mentor
- Listado por alumno/negocio: activación, última actualización, consultas, ganados, facturación, contribución, objetivos, tendencia y porcentaje de datos faltantes.
- Filtros por período, canal, progreso y alertas por baja actividad, falta de carga, empeoramiento de métricas, pendientes prolongados; alertas prudentes ante muestras pequeñas.
- Drill-down al dashboard del negocio y detalles autorizados, con auditoría de accesos.
- Análisis agregado de cohortes y evolución de alumnos, sin doble contar negocios; informes comparativos antes/después. Usar testimonios y datos identificables según consentimiento y derechos aplicables, aunque el contrato incluya autorización comercial.

## 11. Plan de construcción iterativa
**V1A — Base confiable:** autenticación, negocios, panel alumno/mentor, contactos, oportunidades, estados, presupuestos, ventas, cobros, reversiones, auditoría, carga rápida, objetivos, dashboard, filtros de fechas, embudo y exportación.

**V1B — Decisiones y captación:** proyecciones, semáforos con objetivos, análisis por fuentes, prospección CSV, snapshots manuales de Instagram/Ads, fichas de contenido y diagnóstico de cuellos de botella.

**V1C — Automatización opcional:** APIs oficiales Instagram/Meta Ads, captura de enlace, conexión de WhatsApp evaluada con cuidado, IA con Anthropic BYOK, clasificación de conversaciones, ángulos y análisis de objeciones.

**V2 / fuera de alcance inicial:** stock, caja/arqueos, múltiples sucursales, jerarquía de empleados, contabilidad integral, operaciones detalladas de reparaciones.

## 12. Criterios de aceptación y pruebas mínimas
1. Un contacto realiza dos consultas de servicios diferentes: un contacto, dos oportunidades, dos consultas si realmente son distintas.
2. Una persona pregunta tres días seguidos por la misma reparación: una oportunidad, no tres.
3. Mensaje de proveedor o conversación personal: cero consultas calificadas.
4. Presupuesto de $100.000; seña de $20.000 sin aceptación firme: venta ganada $0, cobrado $20.000, pendiente comercial en seguimiento/reserva.
5. Reparación aceptada por $100.000 con anticipo $50.000: una venta ganada de $100.000, cobrado $50.000, saldo $50.000.
6. Cobro de saldo $50.000: venta sigue siendo una, total cobrado $100.000, no duplicar la facturación.
7. Reversión con devolución: ajustar ventas, cobros y contribución sin borrar historial y sin duplicar devolución.
8. IA sugiere que algo se cerró; sin confirmación del alumno permanece sugerencia, sin entrar a métricas de ventas confirmadas.
9. Tres reels con el mismo ángulo, conversación sobre el mismo problema: no inferir que la consulta vino por esos reels.
10. Una venta vinculada a dos ángulos aparece al filtrar por cada uno, pero el total monetario del negocio no se duplica.
11. Sin datos para un período: mostrar `Sin datos`, no cero, y no emitir diagnóstico falso.
12. Un alumno nunca puede acceder al negocio de otro; el mentor accede a los asignados y queda rastro de accesos sensibles.
13. Los totales cambian correctamente con 30/60/90 días y períodos personalizados, y la comparación usa ventanas equivalentes.
14. Si hay registros agregados semanales y registros por oportunidad en el mismo período, no duplicar las consultas.

## 13. Pendientes de configuración, no bloqueantes para iniciar
- Nombre definitivo de tipos de consulta y definición operacional de cliente.
- Política y precio de suscripción luego de MDM.
- Umbrales iniciales de semáforos (configurables, por meta y tamaño de muestra).
- Selección de tecnologías y hosting, presupuestos, copias de seguridad y retención.
- Viabilidad efectiva de cada integración, permisos, revisiones de privacidad y seguridad.
- Gestión de importación histórica y migración desde datos de los alumnos.

## 14. Instrucción inicial para Claude Code
> Leé este documento completo como fuente de requisitos. Antes de programar, proponé arquitectura, entidades SQL y migraciones, políticas de acceso por negocio, definición exacta de cada KPI, flujos de carga manual y diseño de pantallas. Señalá contradicciones o supuestos, sin inventar reglas comerciales. Construí V1A en iteraciones pequeñas con tests para los 14 criterios de aceptación, datos de ejemplo claramente ficticios y un registro de funciones implementadas y pendientes. No implementes WhatsApp por QR ni conexiones oficiales ni envíes conversaciones a IA hasta completar análisis de viabilidad, seguridad y privacidad. No crees stock, caja ni ERP en V1A.
