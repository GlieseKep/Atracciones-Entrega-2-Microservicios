# Plan · Cancelación sin reembolso (solo reservas web)

> **Reemplazado (cancelación):** la parte de cancelación de este plan la reemplaza `PLAN_CANCELACION_CON_REEMBOLSO.md`. La sección «Corrección: check-in solo el día del turno» sigue vigente.

## Decisión tomada: opción B

Desde nuestra web (cliente o `ADMIN`) solo se cancelan reservas hechas en la página web. La cancelación de Booking (compensación de su saga, `SAGA_ORCHESTRATOR`, sobre sus reservas `SOCIO`) queda **igual que antes**, como pide el contrato v3.

## Reglas

1. **Reservas web (`res_canal = 'WEB'`):** las cancela el cliente dueño o un `ADMIN`, sin reembolso y sin el plazo de cancelación gratuita de Catalog. Si la orden sigue sin pagar se cancela; si ya está pagada queda `PAGADA`.
2. **Reservas de Booking (`res_canal = 'SOCIO'`):** solo las cancela `SAGA_ORCHESTRATOR`, igual que antes: reembolso si hay pago aprobado y, si no, se cancela la orden. Si se intenta cancelar una desde la web (como `CLIENTE` o `ADMIN`), responde `409 RESERVATION_NOT_CANCELLABLE`.
3. **Solo antes del check-in** (los dos canales): se cancela en `PENDING` o `CONFIRMED`. En `CHECKED_IN` o `COMPLETED` responde `409 RESERVATION_NOT_CANCELLABLE` («La reserva ya tiene check-in»). `EXPIRED` sigue sin poder cancelarse, y `CANCELLED` sigue devolviendo la reserva tal cual (idempotente).
4. **Al cancelar se devuelve el stock:** las personas de la reserva vuelven al cupo disponible del turno (`disponibilidad.dis_cupo_reservado -= blo_cantidad`) y se publica `STOCK_ACTUALIZADO` con el nuevo cupo.

No hace falta tocar la base de datos: `res_canal` ya existe (migración `1796000001200-ReservaCliente`), y `ReleaseSeats` de Inventory ya reintegra los cupos una sola vez por `bloqueo_cupo`.

## Cambios por módulo (implementados)

### ms-booking (`apps/services/ms-booking`)

**`src/application/cancellation-flow.ts`**

```
require(id) → assertOwner → assertRequester
si CANCELLED                               → devolver tal cual
si SOCIO y solicitante ≠ SAGA_ORCHESTRATOR → 409 RESERVATION_NOT_CANCELLABLE
si estado ∉ {PENDING, CONFIRMED}           → 409 RESERVATION_NOT_CANCELLABLE ("ya tiene check-in" / "está EXPIRED")
WEB:   cancelOrder (se ignora ORDER_ALREADY_PAID; sin reembolso)
SOCIO: getOrder → createRefund (si hay pago aprobado) o cancelOrder   ← igual que antes
releaseSeats(RES-<ord_numero>)  → cupos de vuelta al turno
transition(PENDING|CONFIRMED → CANCELLED) + RESERVA_CANCELADA y STOCK_ACTUALIZADO
```

- Se quita `assertDeadline`, el plazo de cancelación gratuita, que antes solo se aplicaba a `CLIENTE`.
- `remote.refund()` se mantiene, porque lo sigue usando la cancelación de Booking.

**`src/application/reservation-mapper.ts` + `src/contract.ts`:** nuevo campo de extensión `canal: 'WEB' | 'SOCIO'` en la respuesta de la reserva. `reembolso_id` y `monto_reembolsado` se mantienen porque están en el contrato v3.

**`src/integration/esb-routes.ts`, `README.md` y el comentario de `apps/partner-api/src/handlers/reservations.ts`:** textos actualizados.

### Web (`AtraccionesService-web`)

| Archivo | Cambio |
|---|---|
| `src/types/booking.ts` | `canal?: 'WEB' \| 'SOCIO'` en `Reservation`. |
| `src/pages/ReservationDetailPage/index.tsx` | «Cancelar reserva» solo si `canal !== 'SOCIO'` y el estado es `PENDING`/`CONFIRMED`. Se quita el aviso «Reembolso …». Los textos dicen que no hay reembolso. |
| `src/pages/admin/AdminOperationsPages.tsx` | «Cancelar» solo en reservas web en `PENDING`/`CONFIRMED`. El diálogo y el toast ya no hablan de reembolso. |
| `src/pages/admin/AdminOrdersPage.tsx` | Se quitan el botón y el diálogo «Reembolso parcial». |
| `src/api/admin.ts` | Se quita `operationsApi.refund`. |
| `src/features/content/faq.ts`, `src/pages/HelpPage/index.tsx` | Nueva política de cancelación. |

### Sin cambios

- **ms-inventory:** `ReleaseSeats` ya reintegra el cupo y es idempotente.
- **ms-order:** `cancelOrder` ya rechaza las órdenes pagadas con `ORDER_ALREADY_PAID`; Booking lo absorbe en las reservas web.
- **ms-refund:** solo lo usa la cancelación de Booking.
- **Expiraciones automáticas** (`lifecycle.ts`) y rechazo de pago (`payment-events.ts`) siguen liberando cupos como hoy.

## Corrección: check-in solo el día del turno

### Problema (verificado)

Hoy el check-in no valida la fecha del turno. Se puede marcar asistencia de una reserva `CONFIRMED` antes de la fecha que sería la atracción.

- `apps/services/ms-booking/src/application/checkin-service.ts`, en `checkIn()`, trae el turno (`remote.slot(dis_id)`, que incluye `fecha` y `hora`), pero solo usa `slot.atraccion_id` para los permisos. Valida el estado, el documento, el QR y los asistentes, pero nunca la fecha.
- El panel (`AdminCheckinPage.tsx`, `CheckinForm.tsx` y el botón «Confirmar Asistencia» de `AdminOperationsPages.tsx`) muestra la fecha, pero no la valida.
- **Efecto secundario:** `Lifecycle` pasa a `COMPLETED` las reservas `CHECKED_IN` según el día del check-in (`reservation-repository.ts`, en `checkedInBefore`, compara contra `res_checkin_en`). Un check-in adelantado deja la reserva `COMPLETED` al día siguiente, antes de que ocurra la actividad.
- Esto también afecta a la nueva regla de cancelación: un check-in adelantado por error dejaría esa reserva sin poder cancelarse.

### Solución

**ms-booking: `src/application/checkin-service.ts`.** Esta es la validación que cuenta. Va en el backend para que aplique igual al panel, a la Partner API y a GraphQL.

Después de validar el estado `CONFIRMED`, y antes de comprobar el documento, se agrega:

```ts
import { todayIn } from '@atracciones/platform';
...
const today = todayIn();                    // fecha de negocio (America/Guayaquil), igual que en Lifecycle
if (slot.fecha !== today) {
  throw AppError.conflict(
    'CHECKIN_OUT_OF_DATE',
    slot.fecha > today
      ? `El check-in solo se hace el día del turno (${slot.fecha}).`
      : `El turno de esta reserva ya pasó (${slot.fecha}).`,
  );
}
```

- La regla es «el mismo día del turno», según la zona horaria del negocio (`BUSINESS_TIME_ZONE`, la misma que usan `Lifecycle` y `todayIn()`).
- No se compara contra la hora exacta: el guía puede validar antes o después de la hora del turno durante ese día.
- La respuesta es `409`, igual que `RESERVATION_NOT_CONFIRMED`. La idempotencia no cambia: un reintento con la misma `Idempotency-Key` después de un check-in correcto sigue devolviendo el pase ya emitido.
- Con esto, `res_checkin_en` siempre cae en la fecha del turno, así que `checkedInBefore` vuelve a ser correcto sin tocarlo. Si se quiere blindar igual, se puede cambiar para que compare contra la fecha del turno (`slots(dis_ids)`, como hace `expireNoShows`), pero no es necesario.

**Partner API: `apps/partner-api/src/handlers/reservations.ts`.** Solo se corrige el comentario de `checkIn` («identidad, voucher y fecha los valida Booking»), que hoy es falso y con este cambio pasa a ser cierto. El error `409 CHECKIN_OUT_OF_DATE` llega al socio tal cual por el ESB.

**Web (panel admin).** Es solo una ayuda visual; la regla la impone Booking.

| Archivo | Cambio |
|---|---|
| `src/pages/admin/AdminOperationsPages.tsx` | «Confirmar Asistencia» solo aparece si `r.status === 'CONFIRMED'` y `r.date` es hoy. |
| `src/pages/admin/AdminCheckinPage.tsx` | Si la reserva encontrada no es de hoy, se muestra un aviso («Esta reserva es para el dd/mm; el check-in solo se hace ese día») en lugar del formulario. |
| `src/utils/dates.ts` | Helper `isToday(fecha)` con la fecha local de Ecuador (`America/Guayaquil`), para no depender de la zona horaria del navegador. |

### Datos ya afectados

Las reservas de prueba que ya tienen un check-in adelantado (estado `CHECKED_IN` o `COMPLETED`, con una `fecha` del turno posterior al día de `res_checkin_en`) no se corrigen solas. Si hace falta, se devuelven a `CONFIRMED` a mano en `ms_booking`. No se programa una migración para esto.

## Verificación

- `npm run build` (tsc) en la raíz y `npm run build` en `AtraccionesService-web`.
- En el navegador: una reserva con turno en otro día no muestra «Confirmar Asistencia». Si se fuerza el check-in por API, responde `409 CHECKIN_OUT_OF_DATE`. Una reserva de hoy sí permite el check-in.
- En el navegador, sobre la página desplegada: crear una reserva web, ver el cupo del turno, cancelarla desde «Mi cuenta» y comprobar que el cupo subió en la cantidad de personas; comprobar que una reserva con check-in y una de Booking no muestran «Cancelar».
