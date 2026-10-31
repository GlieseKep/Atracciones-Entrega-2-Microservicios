# Plan de implementación · ms_booking (Booking Service, gRPC)

| | |
|---|---|
| Microservicio | 11 · Booking Service |
| Protocolo | gRPC sobre HTTP/2; el ESB traduce las rutas REST del contrato |
| Clasificación (arquitectura_esb_v3) | Asíncrono, con Outbox: `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `RESERVA_CANCELADA`, `STOCK_ACTUALIZADO` |
| Contrato | [booking.proto](booking.proto) |
| Contrato externo de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` y `GUIA_INTEGRACION_SOCIOS(1).md` |
| Base de datos | [ms_booking.sql](ms_booking.sql) → base `ms_booking` |
| Ref. externas | `det_id`, `ord_numero` (Order); `dis_id` (Inventory); `gui_id` (Catalog); `idem_sujeto` (Identity) |
| Puerto local propuesto | `GRPC_PORT=50069` |

## 1. Objetivo

Programar el servicio dueño de las reservas. Atiende las rutas de compra, consulta, cancelación y check-in del contrato v3, coordina
el proceso de compra y publica el feed `GET /atracciones/eventos`.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 11 de `02_microservicios_v2_bases_de_datos.sql` | `estado`, `reserva`, `reserva_pasajero`, `idempotencia`, `outbox_evento`. La fecha, la hora y el `slot_id` se leen de `disponibilidad`. El evento se escribe en la misma transacción que la reserva |
| `arquitectura_esb_v3.html` | Booking crea la orden en Order, descuenta y reintegra cupos en Inventory, y pide guía y punto de encuentro a Catalog. Consume los eventos de Payment y Refund. Booking Prototipo lee el Outbox |
| Contrato v3 | Rutas de reservas y eventos, `409 OUT_OF_STOCK` como único detonador de la saga de Booking Prototipo, `400 SLOT_TIME_MISMATCH`, `422` de validación, `Idempotency-Key` por 24 horas |

### Cambios al script general, todos exigidos por el contrato

| Cambio | Motivo en el contrato |
|---|---|
| `ord_numero` | `external_order_id` es obligatorio en la respuesta |
| `res_reembolso_id`, `res_monto_reembolsado` | La respuesta de la cancelación los devuelve |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Fecha y hora de la reserva.** El script las lee de `disponibilidad` para respetar la 3FN, y el contrato las exige en cada respuesta.
   Se sigue el script, con `GetSlotsByIds` de Inventory. **Consecuencia:** cada consulta de una reserva depende de Inventory.
2. **`det_id`.** Order tiene una línea por tipo de boleto, y `reserva` apunta a una sola. Se guarda la línea de adultos, que
   siempre existe, y usar `ord_numero` para la orden completa.
3. **Guía y punto de encuentro.** `reserva` solo guarda `gui_id`: Catalog asigna el primer guía activo del operador y
   responde con `GET /internal/atracciones/{id}/logistica`. Si no hay guía, `guia_asignado` es `Por asignar`, porque es obligatorio.
4. **Dueño de la reserva.** `reserva` no tiene usuario: el dueño está en `orden`: Booking lo consulta a Order para autorizar.
   Un `ADMIN` puede verlas todas.
5. **Estado en la respuesta `201`.** Una compra de Booking Prototipo se aprueba de inmediato y responde `CONFIRMED`. Una del
   portal responde `PENDING` y pasa a `CONFIRMED` con `PagoAprobado`, o a `CANCELLED` con `PagoRechazado`, reintegrando los cupos.
6. **Reembolso al cancelar.** La arquitectura no indica quién lo pide, y la respuesta necesita `reembolso_id`: Booking llama
   a Refund por el ESB y responde con el resultado.
7. **Plazo de cancelación.** Se lee de Catalog. `CLIENTE` fuera de plazo → `409 CANCELLATION_DEADLINE_PASSED`.
   `SAGA_ORCHESTRATOR` y `ADMIN` no tienen plazo.
8. **Estados finales.** Un proceso periódico pasa a `EXPIRED` las `PENDING` de más de 30 minutos (reintegrando cupos) y las
   `CONFIRMED` sin check-in cuya fecha ya pasó, y a `COMPLETED` las `CHECKED_IN` de días anteriores.
9. **Diferencias entre el contrato y la guía.** La guía para socios envía `customer.name`, sin `document_type`, y `booking_reservation_id`.
   Se aceptan ambos formatos. Si falta el tipo, 10 dígitos es `CEDULA`, 13 es `RUC` y otro es `PASAPORTE`.
   `booking_reservation_id` se guarda en `res_saga_id`.
10. **`STOCK_ACTUALIZADO`.** Se escribe en la misma transacción de la reserva, porque Booking es quien mueve los cupos.
11. **Pasajeros.** `CreateReservaRequestV3` no tiene lista de pasajeros: solo se guarda el titular.
12. **`voucher_qr_url` e `ics_calendar_url`.** Son opcionales y ninguna ruta del contrato los sirve: no se envían.
13. **Moneda.** `reserva` no la guarda y el contrato dice USD: `currency` es siempre `USD`.
14. **Clave repetida con otros datos.** La misma `Idempotency-Key` con otro `idem_request_hash` → `409 IDEMPOTENCY_CONFLICT`.

## 4. Estructura del servicio (`apps/services/ms-booking`)

```
apps/services/ms-booking/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          gRPC, consumidores, publicador del Outbox y proceso de estados
    app.ts                           configuración y manejadores gRPC
    contract.ts                      tipos del contrato
    application/
      purchase-flow.ts               compra y sus compensaciones
      cancellation-flow.ts           cancelación, reembolso y cupos
      checkin-service.ts             check-in
      lifecycle.ts                   EXPIRED y COMPLETED
      payment-events.ts              PagoAprobado y PagoRechazado
      reservation-mapper.ts          reserva -> ReservaConfirmadaResponseV2 con sus alias
      voucher.ts                     firma y verificación del QR
      idempotency.ts                 Idempotency-Key por 24 horas
      input.ts                       validación y regla slot_id / date / time
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      booking-client.ts              cliente para los demás componentes
    persistence/
      data-source.ts
      reservation-repository.ts
      event-repository.ts            outbox_evento
      idempotency-repository.ts
      migrations/
        index.ts
        <timestamp>-BookingSchema.ts        DDL y estados de ms_booking.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 4 programadas en `apps/services/ms-booking`; compila y el `.proto` carga. Sin pruebas. Falta la Fase 5, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar `booking.proto` a `packages/contracts/proto/`.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL completo de `ms_booking.sql`.
- [x] `ReservationRepository`: crear con el titular, buscar por `res_uuid` o `res_codigo`, cambiar de estado y listar.
- [x] `EventRepository`: escribir `outbox_evento` en la transacción de la reserva, y listar por `after`, `limit` y `type`.
- [x] `IdempotencyRepository`: reservar la clave, guardar la respuesta y limpiar las vencidas.

### Fase 2 · Compra (`CreateReservation`)
- [x] Idempotencia: una clave ya procesada devuelve la misma respuesta.
- [x] Validación:
  - `slot_id` distinto de `date` o `time` → `400 SLOT_TIME_MISMATCH`.
  - Fecha pasada, `adult_count < 1` o atracción inexistente → `422`.
- [x] Pasos:
  1. Catalog: atracción y guía.
  2. Order: crea la orden y sus líneas, con la fecha de la actividad para la tarifa; devuelve `ord_numero`, `det_id` y el total.
  3. Inventory: `ReserveSeats` por `slot_id`. Sin cupos: cancela la orden y responde `409 OUT_OF_STOCK`.
  4. Guarda la reserva y escribe `RESERVA_CREADA` y `STOCK_ACTUALIZADO`.
  5. Order inicia el pago con `StartPayment`, con los cupos ya descontados. Si queda aprobado, `CONFIRMED` y `RESERVA_CONFIRMADA`.
  6. Si un paso falla, deshace los anteriores en orden inverso y responde `500` o `503`.
- [x] `res_codigo` con formato `DEC-XXXXXX`, y voucher firmado con HMAC-SHA256 en `res_voucher_qr`.
- [x] Cabecera `Location` y `_links`.

### Fase 3 · Consulta, cancelación y check-in
- [x] **`GetReservation`:** acepta UUID o PNR; arma la respuesta con Inventory y Catalog.
- [x] **`CancelReservation`:** idempotente. Refund con `res_uuid` como clave (con `409 NO_APPROVED_PAYMENT` llama a `CancelOrder`), `ReleaseSeats`, `CANCELLED` y `RESERVA_CANCELADA`, en ese orden. Una reserva ya
      cancelada devuelve la misma respuesta. `CHECKED_IN` o `COMPLETED` → `409`.
- [x] **`CheckIn`:**
  - Solo `CONFIRMED`, y `documento_identidad` debe ser el del titular.
  - Si llega `codigo_voucher_qr`, se verifica su firma.
  - Reserva cancelada → `409`.
  - Guarda hora, documento, guía y dispositivo. Responde `CheckinResponse`.
  - Permisos: `ADMIN`, `OPERADOR` de la atracción, o un `CLIENTE_API`.
- [x] `ListReservations` y `Health`.

### Fase 4 · Eventos
- [x] Publicador: envía al bus lo pendiente de `outbox_evento` y marca `evt_publicado_en`.
- [x] `ListEvents`: `limit` máximo del contrato; `payload` y `data` llevan el mismo contenido; `aggregate_id` es el PNR.
- [x] Consumidores de `PagoAprobado`, `PagoRechazado` y `ReembolsoEmitido`, idempotentes por el estado de la reserva.
- [x] Proceso de estados de la decisión 8.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `booking.*`, traduciendo REST a gRPC y `payload_json` a `payload` y `data`.
- [ ] **API Gateway / Partner API:** exponer las rutas de reservas y eventos.
- [ ] **Inventory:** `GetSlotsByIds` (agregado a su plan).
- [ ] **Catalog:** ruta de logística (agregada a su plan).
- [ ] **Order, Refund:** el plan de cada uno debe incluir lo que Booking les pide.
- [ ] **GraphQL:** compra, mis reservas y cancelación por el ESB.

## 6. Criterios de aceptación

- Las rutas de reservas y eventos cumplen el contrato v3: campos, alias y códigos HTTP.
- `reservation_id` es `res_uuid`, nunca `res_id`.
- Sin cupos, la respuesta es `409` con `code: OUT_OF_STOCK`, y no queda ninguna orden abierta.
- Repetir una compra, cancelación o check-in con la misma `Idempotency-Key` devuelve la misma respuesta.
- Cancelar reintegra los cupos de inmediato.
- El evento y el cambio de la reserva se guardan juntos o no se guardan.
- `after` entrega los eventos en orden, sin saltos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Inventory o Catalog caídos impiden consultar reservas | Consecuencia aceptada de la 3FN (decisión 1) |
| Fallo entre pasos de la compra | Compensación en orden inverso; `bloqueo_cupo` y la idempotencia permiten reintentar |
| Booking Prototipo reintenta con un tiempo de espera corto | La idempotencia devuelve la respuesta guardada |
| Diferencias entre el contrato y la guía | Decisión 9: se aceptan ambos formatos |
