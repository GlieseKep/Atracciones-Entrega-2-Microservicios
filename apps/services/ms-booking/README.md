# ms-booking · Booking Service (HTTP interno)

Dueño de las reservas. Atiende la compra, la consulta, la cancelación y el check-in del contrato v3, coordina el proceso de compra y alimenta el feed `GET /atracciones/eventos`.

- Contrato: [`Plan/ms_booking/booking.proto`](../../../Plan/ms_booking/booking.proto), copiado en `packages/contracts/proto/internal/ms-booking.proto`
- Base de datos: `ms_booking` ([`Plan/ms_booking/ms_booking.sql`](../../../Plan/ms_booking/ms_booking.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_booking/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_booking/PLAN_IMPLEMENTACION.md)

## Compra

Catalog → Order (crea la orden) → Inventory (descuenta cupos) → reserva y eventos → Order (inicia el pago). Si un paso falla, deshace los anteriores en orden inverso. Sin cupos responde `409 OUT_OF_STOCK`.

Una compra de Booking Prototipo responde `CONFIRMED`. Una del portal responde `PENDING`, y pasa a `CONFIRMED` con `PagoAprobado`, o a `CANCELLED` con `PagoRechazado`.

## Cancelación

Solo antes del check-in (`PENDING` o `CONFIRMED`).

- **Reservas de la web** (`res_canal = 'WEB'`): las cancelan el cliente o un `ADMIN`, sin reembolso y sin plazo de Catalog. Se cancela la orden si sigue sin pagar (una pagada queda pagada) y los cupos vuelven al turno en Inventory.
- **Reservas de Booking** (`res_canal = 'SOCIO'`): solo las cancela la compensación de la saga (`SAGA_ORCHESTRATOR`), como siempre: reembolso, cupos y estado; sin pago aprobado, se cancela la orden. Desde la web responden `409 RESERVATION_NOT_CANCELLABLE`.

## Check-in

Solo el día del turno (fecha de negocio, `America/Guayaquil`), a cualquier hora de ese día. Otro día responde `409 CHECKIN_OUT_OF_DATE`.

## Estados automáticos

Cada 5 minutos: `PENDING` de más de 30 minutos y `CONFIRMED` sin check-in con fecha pasada pasan a `EXPIRED`; `CHECKED_IN` de días anteriores, a `COMPLETED`.

## Reglas

- `reservation_id` es `res_uuid`, nunca `res_id`.
- Fecha, hora y `slot_id` se leen de Inventory; guía y punto de encuentro, de Catalog.
- `CreateReservation`, `CancelReservation` y `CheckIn` son idempotentes por `Idempotency-Key` durante 24 horas. Otra solicitud con la misma clave responde `409 IDEMPOTENCY_CONFLICT`.
- `customer` acepta los nombres del contrato y los de la guía para socios.

## Eventos

- **Publica:** `booking.RESERVA_CREADA`, `booking.RESERVA_CONFIRMADA`, `booking.RESERVA_CANCELADA` y `booking.STOCK_ACTUALIZADO`, desde `outbox_evento`, en la misma transacción que la reserva.
- **Consume:** `payment.PagoAprobado`, `payment.PagoRechazado` y `refund.ReembolsoEmitido`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_BOOKING_ROUTES` (`src/integration/esb-routes.ts`). El ESB debe exponer `payload_json` como `payload` y `data`.
- **Cliente:** `BookingClient` (`src/integration/booking-client.ts`).
- **Llama por el ESB a:** Catalog, Order, Inventory y Refund.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-booking
INTERNAL_TOKEN_SECRET=... SERVICE_TOKEN=... VOUCHER_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-booking/dist/main.js
```

