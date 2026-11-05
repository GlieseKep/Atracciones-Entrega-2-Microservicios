# Plan · Requisitos de la defensa con Booking

| | |
|---|---|
| Fecha | 2026-11-05 |
| Origen | Requisitos de Booking para el Flujo 2 (llegada del turista), la sincronización de stock y la observabilidad |
| Servicios | Web (panel), ms-booking, ms-inventory, ms-catalog, Partner API, GraphQL, `packages/platform`, `booking-mock` |
| Estado | Programado (fases 1 a 4). Solo se compiló: nada se probó en ejecución. Falta desplegar y correr la sección 6 |

## 1. Resumen

| # | Requisito | Estado | Qué falta |
|---|---|---|---|
| 1.1 | Buscar la reserva por código, cédula o correo | **Falta** | `/admin/reservas` solo filtra por estado; `/admin/checkin` solo busca por código o UUID |
| 1.2 | Estado inicial `RESERVADO` / `PENDIENTE_ASISTENCIA` | **Falta** | Hoy se ve «Confirmada» |
| 1.3 | Botón «Confirmar Asistencia / Check-in» en la pantalla de reservas | **Parcial** | Existe en `/admin/checkin`, no en `/admin/reservas` |
| 1.4 | Al confirmar, se ve `CONFIRMADO_ASISTIDO` | **Falta** | El estado interno pasa a `CHECKED_IN` y se ve «Check-in hecho» |
| 1.5 | Aviso a `POST …/api/v3/reservas/{external_order_id}/checkin` | **Cumple** | Comprobar contra Booking Central real |
| 2.1 | Crear o editar cupos actualiza Booking | **Parcial** | Editar el cupo de un horario no cambia sus turnos ni avisa a Booking |
| 2.2 | Envío de stock a Booking | **No se toca** | La configuración actual ya se probó y funcionó, según informó el usuario (D2) |
| 2.3 | Una atracción nueva aparece en Booking con sus cupos | **Riesgo** | Si Booking responde `ITEM_NOT_FOUND`, ese stock se da por entregado y no se reintenta |
| 3.1 | `GET /api/v3/health` con base de datos y RabbitMQ | **Parcial** | Existe, pero no informa RabbitMQ y `database_connected` significa otra cosa |
| 3.2 | Logs de consultas de clientes | **Falta** | Solo la línea HTTP genérica |
| 3.3 | Logs de reservas recibidas | **Falta** | Solo la línea HTTP genérica |
| 3.4 | Logs de envíos de stock hacia Booking | **Falta** | Los envíos correctos no se registran. El requisito habla de tramas gRPC, y la configuración actual envía por REST |
| 3.5 | Logs del check-in con `X-Correlation-Id` | **Parcial** | No hay log del check-in; los reintentos del aviso pierden la correlación |
| Extra | Booking reserva en `POST ${baseUrlRest}/reservas` | **Riesgo** | Solo existe `/api/v3/atracciones/reservas`; ver decisión D3 |

**Ya cumple y no se toca:**
- Cuerpo del aviso (`estado: CONFIRMADO_ASISTIDO`, `client_id`, `asistentes_reales`, `admin_id`, `fecha_checkin`, `observaciones`).
- Reintentos del aviso con espera creciente.
- Solo se avisan las compras hechas por un socio (`res_canal = 'SOCIO'`).
- Logs en JSON con `timestamp` y `correlation_id`.
- Venta, cancelación, cambio de cupo de un turno, cierre y bloqueo de fechas ya generan stock para Booking.
- `GET/POST /api/v3/clientes`.

## 2. Decisiones

| # | Tema | Propuesta |
|---|---|---|
| D1 | Nombres de estado | **La API no cambia:** el contrato v3 solo admite `PENDING`, `CONFIRMED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED` y `EXPIRED`. Solo cambia lo que se ve en el panel: `CONFIRMED` → «RESERVADO · pendiente de asistencia», `CHECKED_IN` → «CONFIRMADO_ASISTIDO». `PENDING` sigue como «Pendiente de pago», porque aún no admite check-in |
| D2 | gRPC o REST | **Decidido por el usuario: la configuración actual no se cambia.** Ya se probó y funcionó. No se añade cliente gRPC ni se quita nada del envío actual (`BOOKING_REST_STOCK_URL`, opción A de `GUIA_SOCIOS_AZURE_APP_SERVICE(1).md`, Parte 4) |
| D3 | Ruta de reservas | **Añadir `POST /api/v3/reservas` como alias** de `/api/v3/atracciones/reservas`, sin quitar la del contrato. Funciona sea cual sea el `baseUrlRest` que Booking tenga registrado |
| D4 | Documento en el check-in | El contrato exige `documento_identidad`, y hoy el guía debe escribirlo. **Precargarlo con el del titular**, editable, con la casilla «Verifiqué el documento físico». Agiliza la demostración; el backend sigue comparándolo |
| D5 | Editar el cupo de un horario | **Aplicarlo a los turnos futuros que aún tienen el cupo anterior**, sin bajar de lo ya reservado, y avisar a Booking. Los turnos ajustados a mano se respetan, igual que con el guía |
| D6 | Retirar o eliminar una atracción | **Enviar 0 cupos a Booking** en sus turnos futuros, para que no siga vendiéndola |
| D7 | Búsqueda para guía y operador | `/admin/reservas` sigue siendo solo de `ADMIN`. `/admin/checkin` usa la misma búsqueda para `GUIA` y `OPERADOR`, siempre con texto de búsqueda y sin listar todo. El operador solo ve reservas de sus atracciones |

## 3. Preguntas para Booking

| # | Pregunta | Respuesta |
|---|---|---|
| P1 | ¿A qué host va el gRPC? | `booking-puce.eastus.cloudapp.azure.com:50051`. Sin efecto: no se programa gRPC (D2) |
| P2 | ¿Qué `baseUrlRest` y `service_id` están registrados? | **Por confirmar con Paúl.** Lo que enviamos o configuramos: `https://tourgirls-gateway-mm.azurewebsites.net/api/v3` y `NODE_ATR_MOLINA` (`tools/launcher.mjs`). No usar `NODE_ATR_DILAN`, que es el ejemplo de `Plan/ms_inventory/PLAN_IMPLEMENTACION.md` |
| P3 | ¿Cómo conoce Booking una atracción nueva? | **Booking llama a nuestra tienda** para obtenerla. Falta saber cada cuánto: un stock enviado antes de esa consulta puede responder `ITEM_NOT_FOUND` |
| P4 | ¿La clave de Booking Central es `BOOKING_API_KEY`? | **Sí.** El ESB ya la usa si no hay `BOOKING_CORE_API_KEY` |
| P5 | ¿Qué servicio gRPC usamos? Los documentos se contradicen | **Cerrada: no se programa gRPC** (D2). Ya no hace falta el `.proto` de `UpdateStock` |

## 4. Cambios

### Fase 1 · Panel y búsqueda de reservas (requisito 1)

**ms-booking**
1. Migración nueva e índices en `reserva_pasajero` (`pax_documento`, `lower(pax_correo)`). Actualizar `Plan/02_…sql` y `Plan/ms_booking/ms_booking.sql`.
2. `ListReservationsRequest.q` en los dos `.proto`.
3. `reservationRepository.list`: filtra `q` por `res_codigo`, `ord_numero`, `pax_documento` o `pax_correo`, sin distinguir mayúsculas.
4. `reservationService.list`: permisos según D7.

**Web**
1. `operationsApi.reservations` admite `q`; `AdminReservationsPage` usa el buscador de `AdminTable` («Código, cédula o correo»).
2. Etiquetas de estado del panel según D1, sin tocar las del portal del cliente.
3. Botón **«Confirmar Asistencia»** en las filas `CONFIRMED`. Abre un diálogo con titular, documento (D4), asistentes y observaciones.
4. Sacar ese formulario de `AdminCheckinPage` a un componente común, para no duplicarlo.
5. Tras confirmar, la fila muestra `CONFIRMADO_ASISTIDO` y el aviso «Pendiente». Se relee a los pocos segundos para mostrar «Enviado» o el error.
6. `/admin/checkin` usa la misma búsqueda: el buscador devuelve una lista y se elige la reserva.

### Fase 2 · Sincronización de stock (requisito 2)

**ms-inventory**
El cliente y las variables del envío a Booking no cambian (D2). Estos cambios solo deciden **cuándo** se envía stock:

1. `updateSchedule`: propaga el cupo según D5 y deja el stock en el outbox en la misma transacción.
2. RPC nueva `ResendStock { atraccion_id, cero }`: deja en el outbox el saldo actual de los turnos futuros, o 0 si `cero` es verdadero. Ruta del ESB `inventory.resendStock`.
3. **`ITEM_NOT_FOUND` deja de darse por entregado.** Booking conoce la atracción cuando nos consulta (P3), así que el primer stock puede llegar antes. Solo esperan las filas de esa atracción, sin frenar a las demás, y se reintenta cada minuto durante 30 minutos desde que se creó la fila. Después se da por perdida con un log `STOCK_FALLIDO`, y publicar de nuevo la reenvía. Requiere la columna `proximo_en` en el `outbox` de ms-inventory (migración y SQL del plan).

**ms-catalog**
1. `setState`: al pasar a `PUBLICADA`, llama a `inventory.resendStock`; al retirar, con `cero`. `remove` hace lo mismo que retirar (D6).
2. Si la llamada falla, la publicación no se revierte: se registra y el panel avisa.

### Fase 3 · Observabilidad (requisito 3)

**Salud**
1. `EventBus.status()` devuelve `CONNECTED`, `DISCONNECTED` o `IN_MEMORY`; `RabbitMqEventBus` escucha el cierre de la conexión.
2. `NodeHealth`: `database_connected` pasa a significar solo la base de datos (hoy significa «servicios críticos arriba»). Añade `rabbitmq_connected` y `rabbitmq_status`.
3. RabbitMQ caído da `DEGRADED`: las ventas siguen funcionando y el outbox reintenta.
4. La Partner API le pasa su bus a `NodeHealth` en `main.ts`.

**Logs:** mensajes fijos, a nivel `info`, en el formato JSON actual. Se pueden filtrar en la terminal por `message`.

| Mensaje | Dónde | Campos |
|---|---|---|
| `CLIENTE_CONSULTA_RECIBIDA` | Partner API, `GET /clientes` | `email` e `identificacion` enmascarados, `encontrado`, `client_id` |
| `CLIENTE_REGISTRO_RECIBIDO` | Partner API, `POST /clientes` | Datos enmascarados, `creado`, `client_id` |
| `RESERVA_RECIBIDA` | Partner API, `POST /reservas` | `attraction_id`, `slot_id`, `boletos`, `saga_id` |
| `RESERVA_CREADA` | ms-booking | `reservation_code`, `external_order_id`, `canal`, `status` |
| `STOCK_EMITIDO` | ms-inventory | `transporte` (el real: `rest`), `destino`, `item_id`, `slot_id`, `date`, `available_units`, `resultado`, `duration_ms` |
| `STOCK_FALLIDO` | ms-inventory | Lo mismo más `error` e `intentos` |
| `CHECKIN_EJECUTADO` | ms-booking | `reservation_code`, `external_order_id`, `guia_codigo`, `asistentes_reales` |
| `CHECKIN_AVISO_ENVIADO` / `CHECKIN_AVISO_FALLIDO` | ms-booking | `external_order_id`, `http_status`, `intentos` |

**Correlación**
1. `notificacion_checkin` guarda `nch_correlation_id` (migración); `CheckinNotifier` reintenta dentro de ese contexto.
2. `BookingStockSync` lee el `correlation_id` del outbox y lo usa solo en el log. Lo que se envía a Booking no cambia.
3. Comprobar que el mismo identificador recorra panel → Gateway → GraphQL → ESB → ms-booking → Booking Central.

**Privacidad:** los logs enmascaran correo y documento (`an***@correo.com`, `171*****65`). Nunca incluyen API keys ni el payload del QR.

### Fase 4 · Ruta de reservas (D3)

En la Partner API, antes del validador del contrato, reescribir `POST /api/v3/reservas` hacia `/api/v3/atracciones/reservas`. Reutiliza alias, validación e idempotencia. Comprobar además que el cuerpo de la sección 5.1 de la guía de socios se acepta tal cual.

## 5. Orden de trabajo

1. ~~Confirmar las decisiones D1 y D3 a D7.~~ Hecho. P2 sigue por confirmar con Paúl; no frena nada, porque el alias acepta las dos rutas.
2. ~~**Fase 4:** es lo más pequeño, y sin ella el Flujo 1 puede fallar del todo.~~ Hecho.
3. ~~**Fase 2:** Flujo 1.~~ Hecho.
4. ~~**Fase 1:** Flujo 2.~~ Hecho.
5. ~~**Fase 3:** al final, para registrar también el código nuevo.~~ Hecho.
6. Compilar con `npm run build` y `vite build`, desplegar y correr la sección 6. Pendiente el despliegue y la sección 6.

No se escriben pruebas automáticas, según la preferencia del proyecto.

## 6. Comprobación tras desplegar

**Flujo 1**
1. Crear una atracción, su tarifa y un horario de 10 cupos, y publicarla.
2. En los logs debe aparecer `STOCK_EMITIDO` con `resultado: delivered`.
3. Booking muestra 10 cupos en ese turno.
4. Booking reserva 2: aparece `RESERVA_RECIBIDA`, el panel muestra 8 y Booking también.
5. Cambiar el cupo del turno a 15: Booking muestra 13.

**Flujo 2**
1. En `/admin/reservas`, buscar esa reserva por código, luego por cédula y luego por correo.
2. Se ve «RESERVADO · pendiente de asistencia».
3. Pulsar «Confirmar Asistencia»: pasa a `CONFIRMADO_ASISTIDO`, y el aviso a «Enviado».
4. Los logs muestran `CHECKIN_EJECUTADO` y `CHECKIN_AVISO_ENVIADO` con el mismo `correlation_id`.
5. Booking Central responde 200 y registra la llegada.

**Observabilidad**
1. `GET https://tourgirls-gateway-mm.azurewebsites.net/api/v3/health` devuelve `database_connected` y `rabbitmq_connected`.
2. `GET /api/v3/clientes` deja `CLIENTE_CONSULTA_RECIBIDA` en la terminal, con los datos enmascarados.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El panel aún no se ha probado contra el backend real | Correr la sección 6 antes de entregar la ficha |
| El requisito 3 pide logs de tramas gRPC, y los envíos salen por REST | Los logs muestran `transporte: rest`, sin presentarlo como gRPC. Avisar al evaluador: los requisitos aceptan «gRPC o REST» para el stock, y REST es la opción recomendada por la guía de Azure |
| Una atracción con muchos turnos genera cientos de tramas seguidas | El envío es por lotes y en orden; las tramas llevan saldo absoluto. Vigilar que no retrase la venta siguiente de otra atracción |
| Las reservas hechas desde la web no avisan a Booking | Es lo definido en el plan de clientes: el Flujo 2 debe hacerse con una reserva creada desde Booking |
