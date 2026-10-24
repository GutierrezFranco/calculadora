# MDM OS — Revisión de la especificación v1.1

Revisión técnica de `especificacion-funcional-v1.1.md` antes de empezar a construir la V1A.
Las respuestas a las preguntas de la sección 4 se van a ir anotando acá.

## 1. ¿Se puede hacer?

| Bloque | Viabilidad | Comentario |
|---|---|---|
| V1A — Base confiable | Sí, sin riesgos técnicos | CRUD, reglas comerciales, auditoría y dashboard. Todo es lógica propia. |
| V1B — Decisiones y captación | Sí | Proyecciones, semáforos, CSV y snapshots manuales. Solo depende de definir bien las fórmulas. |
| V1C — Instagram / Meta Ads | Sí, con trámite | APIs oficiales de Meta: requieren cuenta profesional, app aprobada por Meta (App Review) y renovar tokens. Métricas por reel limitadas, como ya dice el documento. |
| V1C — IA con clave Anthropic del alumno | Sí | Clave cifrada en servidor y salida JSON validada por esquema. Es directo. |
| V1C — WhatsApp por QR | No recomendado | Conectarse por QR usa librerías no oficiales (WhatsApp Web) que violan los términos de WhatsApp y pueden hacer que le **bloqueen el número al alumno**. La API oficial (WhatsApp Business Cloud API) no lee el historial ni el WhatsApp personal o Business común. Alternativa segura: que el alumno use "Exportar chat" (archivo .txt) y lo suba. |

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

## 4. Preguntas abiertas

Ver la lista numerada en la conversación de inicio del proyecto. Respuestas:

- _(pendiente)_
