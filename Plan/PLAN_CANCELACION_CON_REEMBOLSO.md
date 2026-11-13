# Plan · Cancelación con reembolso simulado y restitución de stock

Reemplaza la «opción B» de `PLAN_CANCELACION_SIN_REEMBOLSO.md` en la parte de la cancelación. La parte de **check-in solo el día del turno** de ese plan sigue vigente y no se toca.

No se cambian tablas, esquemas, puertos gRPC ni endpoints existentes. Solo se **agregan** campos a la respuesta de la cancelación (el contrato v3 no prohíbe propiedades extra en `ReservaConfirmadaResponseV2`) y un alias de ruta.

## Reglas

1. **Quién cancela:** cualquier reserva que no tenga check-in, sea del canal `WEB` o `SOCIO`. Se quita el bloqueo «las reservas de Booking no se cancelan desde la web». La saga de Booking (`SAGA_ORCHESTRATOR`) sigue igual.
2. **Bloqueo por check-in:** en `CHECKED_IN` o `COMPLETED` responde `409` con
   `{ "title": "Cancelación No Permitida", "detail": "No se puede cancelar una reserva que ya realizó check-in o fue asistida.", "status": 409, "code": "RESERVATION_NOT_CANCELLABLE" }`.
   `CONFIRMADO_ASISTIDO` no es un estado de la reserva en nuestro sistema; es el estado del aviso a Booking Central, que solo existe cuando la reserva ya está en `CHECKED_IN`, así que queda cubierto. `EXPIRED` sigue sin poder cancelarse (`409`, mismo título, con el detalle «La reserva está EXPIRED»).
3. **Ya cancelada:** `200` con la reserva tal cual y el mismo bloque de cancelación, sin volver a liberar cupos.
4. **Reembolso del 100 %:**
   - `SOCIO`: igual que hoy. Si hay pago aprobado, va el reembolso real por ms-refund. Si no hay pago, se cancela la orden y se registra el reembolso simulado del punto siguiente.
   - `WEB`: reembolso **simulado**: `REF-ATR-<reservation_code>` (máx. 8 + 12 = 20 caracteres, cabe en `res_reembolso_id VARCHAR(30)`) por `total_price`. No pasa por ms-payment ni por ms-refund. La orden se cancela si sigue sin pagar; si ya está pagada queda `PAGADA`, como hoy.
   - El id y el monto se guardan en `res_reembolso_id` y `res_monto_reembolsado`, que ya existen. Así, un reintento o una consulta posterior devuelven lo mismo.
5. **Stock:** `releaseSeats` devuelve los `ticket_count` al turno una sola vez (ya es idempotente) y se publica `STOCK_ACTUALIZADO`. El estado `AGOTADO` / `ULTIMOS_CUPOS` / `DISPONIBLE` no se guarda: Inventory lo calcula con el cupo libre (`ms-inventory/src/application/availability.ts`), así que cambia solo al devolver los cupos.
6. **Reglas del negocio en el check-in:**
   - Si llegan menos personas que los boletos, no hay reembolso parcial. Se hace el check-in a los asistentes reales y la reserva sigue su curso normal (`CHECKED_IN` → `COMPLETED`). Ya funciona así.
   - Si llegan más personas que los boletos, la reserva no se modifica. El error ya existe; solo cambia el texto para indicar que los boletos extra se compran como una reserva nueva (desde Booking o la web) si quedan cupos en ese turno.

## Respuesta `200` de la cancelación

Son los campos de siempre de `ReservaConfirmadaResponseV2`, más estos (solo cuando `status = CANCELLED`):

```json
{
  "status": "CANCELLED",
  "reembolso_id": "REF-ATR-DEC-7F3K9Q",
  "monto_reembolsado": 75.0,
  "cancel_code": "REF-ATR-DEC-7F3K9Q",
  "refund": { "refund_id": "REF-ATR-DEC-7F3K9Q", "status": "PROCESSED", "amount": 75.0, "currency": "USD", "message": "Reembolso simulado del 100% procesado." },
  "stock_restoration": { "status": "RESTORED", "restored_spots": 3, "message": "Cupos reincorporados a la disponibilidad del operador local." },
  "message": "Reserva cancelada exitosamente y cupos restituidos."
}
```

Si la reserva es `SOCIO` y tuvo reembolso real, `refund_id`, `reembolso_id`, `cancel_code` y `amount` toman el id y el monto que devolvió ms-refund, y el mensaje es «Reembolso del 100% procesado.». Para reservas canceladas antes de este cambio, sin reembolso guardado, `cancel_code` y `refund_id` toman `REF-ATR-<código>` y el monto es 0.

## Cambios por módulo

### Contratos: `packages/contracts/proto/internal/ms-booking.proto`
- Mensajes nuevos: `RefundInfo { refund_id, status, amount, currency, message }` y `StockRestoration { status, restored_spots, message }`.
- En `ReservaConfirmadaResponseV2` se agregan campos nuevos con números libres: `cancel_code = 36`, `refund = 37`, `stock_restoration = 38` y `message = 39`, y también `canal = 40`. El ESB llama a Booking por REST/JSON (`/internal/rpc/...`), así que la web ya recibía `canal` y recibe los campos nuevos sin pasar por el proto; se agregan para que el servicio gRPC exponga lo mismo. No se renumera nada.

### Plataforma: `packages/platform/src/problem-details.ts`
- `TITLES_BY_CODE.RESERVATION_NOT_CANCELLABLE = 'Cancelación No Permitida'`.

### ms-booking
- **`src/application/cancellation-flow.ts`**
  - Se quita `assertChannel`.
  - `assertBeforeCheckin` usa el detalle exacto del contrato para `CHECKED_IN` y `COMPLETED`.
  - Al cancelar: si es `SOCIO`, `refundOrCancelOrder` (como hoy); si es `WEB`, `cancelUnpaidOrder`. Si no hubo reembolso real, se usa el simulado `{ reembolso_id: 'REF-ATR-' + res_codigo, monto_reembolsado: res_precio_total }`. En los dos casos se guarda en la transición.
- **`src/application/reservation-mapper.ts`**: si `est_codigo = 'CANCELLED'`, agrega `cancel_code`, `refund`, `stock_restoration` (`restored_spots = res_numero_tickets`) y `message`.
- **`src/contract.ts`**: tipos de los campos nuevos (opcionales).
- **`README.md`** y **`src/integration/esb-routes.ts`**: textos de la regla nueva.
- **`src/application/checkin-service.ts`**: solo cambia el texto del error de `asistentes_reales` mayor que los boletos, que pasa a ser: «Llegaron más personas que boletos (N). La reserva no se modifica: los X boletos adicionales se compran como una reserva nueva si hay cupos en este turno». Siguen iguales el código, el estado HTTP y la lógica.

### Partner API
- **`src/app.ts`**: alias `POST /api/v3/reservas/:id/cancel` → `/api/v3/atracciones/reservas/:id/cancel`, junto al alias que ya existe para `POST /api/v3/reservas`, antes del validador del contrato.
- **`src/handlers/reservations.ts`**: solo el comentario de `cancel`.

### Web (`AtraccionesService-web`)

| Archivo | Cambio |
|---|---|
| `src/types/booking.ts` | `cancel_code?`, `refund?`, `stock_restoration?`, `message?` en `Reservation`. |
| `src/pages/ReservationDetailPage/index.tsx` | «Cancelar reserva» solo si el estado no es `CHECKED_IN`, `COMPLETED`, `CANCELLED` ni `EXPIRED`, sin importar el canal. En `CHECKED_IN`/`COMPLETED`, etiqueta «Check-in realizado (Servicio iniciado, no cancelable)». El modal de confirmación avisa que se anula la reserva y se liberan los cupos. Al terminar bien, abre un modal con badge verde: «¡Cancelación y Reembolso Exitosos!», «Código de Reembolso: REF-ATR-…», «Monto Reembolsado: 100 % ($xx.xx)», «Stock Reincorporado: ✓ Cupos liberados» y, debajo, los cupos libres del turno, consultados en ese momento a `GET /atracciones/{id}/disponibilidad?date=` (responde `no-store`, así que el dato es actual). Después se refrescan la reserva y la orden. |
| `src/pages/admin/AdminOperationsPages.tsx` | «Cancelar» con la misma condición. Los textos del diálogo y del toast mencionan el reembolso y los cupos liberados. |
| `src/api/bookings.ts`, `src/api/admin.ts` | Solo comentarios: la llamada GraphQL `bookingCancelReservation` no cambia. |
| `src/pages/admin/CheckinForm.tsx` | Mismo texto nuevo para cuando llegan más asistentes que boletos. Se quita el `max` del campo para que el navegador no lo bloquee con su propio aviso antes de mostrar este mensaje. |
| `src/features/content/faq.ts`, `src/pages/HelpPage/index.tsx` | Nueva política: se cancela antes del check-in con reembolso del 100 %. No hay reembolsos parciales en el check-in, y las personas extra compran una reserva nueva. |
| `Plan/PLAN_CANCELACION_SIN_REEMBOLSO.md` | Nota al inicio: la parte de cancelación queda reemplazada por este plan. |

### Sin cambios
ms-inventory (`ReleaseSeats`), ms-order, ms-refund, ms-payment, GraphQL (pasa la respuesta de Booking tal cual), base de datos y migraciones, y los endpoints de búsqueda, catálogo, turnos, reserva y check-in (salvo el texto del error).

## Riesgos

- **Booking no se entera** cuando cancelamos desde la web una reserva `SOCIO`: no hay webhook de cancelación hacia Booking Central en el contrato. Booking la verá `CANCELLED` si consulta `GET /reservas/{id}`.
- **El reembolso de las reservas web es solo un registro:** si la orden ya estaba pagada, no se mueve dinero en ms-payment.

## Verificación

- `npm run build` (tsc) en la raíz y en `AtraccionesService-web`.
- En el navegador, sobre la página desplegada: ver el cupo de un turno, cancelar una reserva web desde «Mi cuenta», comprobar el modal verde y que el cupo subió en `ticket_count`. Comprobar también que una reserva con check-in muestra la etiqueta y no el botón.
