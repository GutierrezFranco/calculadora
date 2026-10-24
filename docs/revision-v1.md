# MDM OS — Revisión de la especificación v1.1

Revisión técnica de `especificacion-funcional-v1.1.md` antes de empezar a construir la V1A.
Las decisiones tomadas están en la sección 4.

## 1. ¿Se puede hacer?

| Bloque | Viabilidad | Comentario |
|---|---|---|
| V1A — Base confiable | Sí, sin riesgos técnicos | CRUD, reglas comerciales, auditoría y dashboard. Todo es lógica propia. |
| V1B — Decisiones y captación | Sí | Proyecciones, semáforos, CSV y snapshots manuales. Solo depende de definir bien las fórmulas. |
| V1C — Instagram / Meta Ads | Sí, con trámite | APIs oficiales de Meta: requieren cuenta profesional, app aprobada por Meta (App Review) y renovar tokens. Métricas por reel limitadas, como ya dice el documento. |
| V1C — IA con clave Anthropic del alumno | Sí | Clave cifrada en servidor y salida JSON validada por esquema. Es directo. |
| V1C — WhatsApp por QR | Sí, con riesgo aceptado | Usa la conexión de WhatsApp Web (como Funnel Chat y el CRM existente), solo lectura. No es oficial: WhatsApp puede bloquear números que detecte. Decisión de Franco: se hace (ver sección 4). |

## 2. Arquitectura propuesta (a confirmar)

- **App web** en Next.js + TypeScript, en español y usable desde el celular para la carga rápida.
- **Base de datos** Postgres (Supabase): login, y políticas de acceso por negocio (RLS) a nivel base de datos, así un alumno no puede ver otro negocio aunque haya un bug en la pantalla (criterio 12).
- **Reglas comerciales** en un módulo propio, sin pantallas, con tests automáticos para los 14 criterios de aceptación.
- **Hosting** en Vercel o Netlify más Supabase. Costo inicial bajo o gratis con pocos alumnos.
- **Importes** guardados en centavos (enteros) con su moneda, nunca con decimales sueltos.

## 3. Contradicciones y huecos detectados

1. **Etapas "Presupuesto aceptado / reservado" y "Señado":** la etapa mezcla *aceptado* con *reservado*, y la regla 6 dice que una reserva no es ganada. No queda claro si "Señado" es la misma etapa o una distinta.
2. **Seña que se pierde:** si el cliente deja seña y después no sigue, ¿se devuelve o el negocio se la queda? Si se la queda, es un cobro sin venta: hay que decidir cómo se muestra.
3. **Fecha para contar cada cosa:** una consulta de marzo que se gana en abril, ¿en qué mes cuenta la venta? ¿Y la tasa de cierre? Hay dos formas: por fecha del evento o por cohorte (mes en que entró la consulta).
4. **Costo directo desconocido:** al ganar la venta muchas veces no se sabe el costo del repuesto. ¿La contribución queda "Sin dato" hasta cargarlo?
5. **Venta rápida (accesorio o mostrador):** pasar por 5 etapas para vender un cargador es mucha fricción. Hace falta un atajo de "venta directa".
6. **"Clientes/ventas ganadas":** ¿cuenta personas distintas o ventas? Un mismo cliente puede tener dos ventas.
7. **Ticket promedio:** ¿sobre lo pactado o sobre lo cobrado?
8. **Carga de consultas:** registrar cada consulta como oportunidad es lo más preciso, pero puede ser mucho trabajo para un técnico con 30 WhatsApps por día. La regla 14 permite totales agregados; falta decidir cuál es el método por defecto.
9. **Inflación y moneda:** con alumnos en Argentina, comparar meses en pesos nominales distorsiona las tendencias. Además, ¿un negocio usa una sola moneda o puede cobrar en pesos y en dólares?
10. **Mentores:** ¿hay un solo mentor (vos) o varios mentores con alumnos asignados?
11. **Suscripción:** cobrar la suscripción no está en V1A. Mientras tanto, ¿el acceso lo activa y desactiva el mentor a mano?
12. **Versión del documento:** el archivo dice v1.1 en el nombre y v1.0 en el título.

## 4. Decisiones tomadas (24/10/2026)

Respuestas de Franco a la primera ronda de preguntas. Mandan sobre la especificación donde la contradicen.

| Tema | Decisión |
|---|---|
| WhatsApp por QR | **Se hace**, solo lectura, como en el CRM existente que reemplazó a Funnel Chat. Queda en V1C. El riesgo de bloqueo del número es una decisión aceptada. |
| Etapas | *Presupuesto aceptado / reservado* y *Señado* son la misma etapa: **Señado** (seña sin compromiso firme, no es ganado). Flujo: Nueva consulta → Presupuestado → En seguimiento → Señado → Ganado / en reparación → Ganado / completado, con Perdido como salida manual. |
| Ganado | El cliente acepta la reparación completa y **deja el equipo**, normalmente pagando el 50 %. Es venta ganada con cobro parcial. |
| Seña de un cliente que no sigue | Lo define cada negocio. Por defecto **no se devuelve** (costumbre en Argentina), pero se puede registrar una devolución. La seña retenida suma a cobrado, no a ventas, y se muestra aparte como "Señas retenidas". |
| Venta rápida | Se carga directo como ganada y cobrada, sin pasar por las etapas. |
| Costo directo faltante | La contribución queda "Sin datos" si ninguna venta tiene costo; si faltan algunos, se avisa cuántas. |
| Fecha de una venta | Cuenta en el período en que **se ganó** (consulta de marzo ganada en abril = venta de abril). |
| Tarjeta Clientes | Personas distintas con al menos una venta ganada en el período. Una persona con dos reparaciones es 1 cliente y 2 ventas. |
| Ticket promedio | Se muestran dos: **pactado** y **cobrado**. |
| Carga de consultas | El alumno carga el **total diario** de consultas (más adelante, detectado desde WhatsApp). Las oportunidades se crean solo para las que avanzan. Si un día no tiene total cargado, se cuentan las oportunidades creadas ese día. Nunca se suman ambos. |
| Dispositivos | Celular, tablet y compu. El kanban se diseña para escritorio y en celular se adapta con columnas deslizables. |
| Monedas | Cada negocio elige su moneda (ARS, CLP, GTQ...) y su cotización contra el dólar. Puede mezclar moneda local y USD. Los totales se muestran por moneda y se convierten solo con cotización explícita. |
| Mentores | Un solo mentor (Franco). Varios mentores queda para más adelante. |
| Acceso de alumnos | El mentor activa y desactiva alumnos desde su panel. |
| Importación | Se adelanta a V1A: **importación guiada** de Excel/CSV/reportes de otros sistemas, con mapeo de columnas propuesto y confirmación del alumno antes de guardar. |
| Stack | Next.js + Supabase + Vercel. |
| WhatsApp por QR (cómo) | Implementación nueva en MDM OS, no se conecta al CRM existente. Se toma el mismo enfoque que ese CRM (repo `ejemplo`, `crm/lib/wa-client.ts`): Baileys como dispositivo vinculado, sesión guardada en la base y reconexión a demanda, sin servidor prendido todo el día. Acá, una sesión por negocio. |
| Cotización del dólar | Una por negocio, el alumno la actualiza a mano cuando quiere. Cada venta y cada cobro guardan la cotización cargada en ese momento. |
| Login | Email y contraseña. El mentor crea las cuentas; no hay registro público. Google, más adelante. |

### Supuestos que tomé y conviene confirmar

- **Oportunidad con venta revertida:** pasa a Perdida (motivo "Venta revertida: …") y cuenta como perdida en la tasa de cierre del período en que se revirtió.
- **Venta revertida:** desaparece del período en que se ganó (los números muestran la situación actual), la devolución de plata cuenta en la fecha en que se devolvió, y la auditoría conserva el original.

## 5. Preguntas abiertas

- Ninguna bloqueante por ahora.
