# Plan · Plazo de 24 horas para cancelar

Amplía `PLAN_CANCELACION_CON_REEMBOLSO.md` (ya implementado en `aa9e7f1`). Las reglas de reembolso del 100 %, la restitución de stock, la respuesta canónica y las reglas del check-in (sin reembolsos parciales y el excedente como reserva nueva) no cambian.

No se tocan tablas, esquemas, puertos gRPC ni endpoints de búsqueda, catálogo, turnos, reservas o check-in.

## Regla

La cancelación con reembolso del 100 % solo se permite con **al menos 24 horas de anticipación** al inicio del turno reservado (`date` + `time`). Si falta menos, o la fecha ya pasó, el backend responde:

```json
{ "title": "Cancelación Fuera de Plazo", "detail": "La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.", "status": 409, "code": "CANCELLATION_DEADLINE_PASSED" }
```

y la web no muestra el botón de cancelar.

**Hora de referencia:** la fecha y la hora del turno se toman en la zona del negocio (`BUSINESS_TIME_ZONE = America/Guayaquil`), la misma que usan `Lifecycle` y el check-in. Para convertirlas se usa `zonedToUtc`, que ya existe en `packages/platform/src/formats.ts`.

**Orden de validación en el backend**, como en el prompt:
1. Ya cancelada: `200` con la reserva tal cual, sin liberar cupos.
2. `CHECKED_IN` o `COMPLETED`: `409 RESERVATION_NOT_CANCELLABLE` «Cancelación No Permitida». Ya existe.
3. Cualquier otro estado que no sea `CONFIRMED` (`PENDING` y `EXPIRED`): `409 RESERVATION_NOT_CANCELLABLE`. En `PENDING`, el detalle es «La reserva aún no está confirmada (pago pendiente); no se puede cancelar.»; en `EXPIRED` sigue «La reserva está EXPIRED.». Es lo nuevo para `PENDING`.
4. Menos de 24 horas para el turno: `409 CANCELLATION_DEADLINE_PASSED` «Cancelación Fuera de Plazo», excepto para la saga. Es lo nuevo.
5. Cancelación, reembolso y restitución de stock, como hoy.

## Decisiones

1. **Compensación de la saga de Booking (`SAGA_ORCHESTRATOR`): sin plazo** (decidido). Booking siempre puede revertir un paquete fallido. Ojo: la Partner API asume `SAGA_ORCHESTRATOR` cuando un socio no envía `solicitante`.
2. **`ADMIN`: con plazo** (decidido). El panel oculta «Cancelar» si falta menos de 24 h y el backend responde `409` también al `ADMIN`.
3. **Solo se cancelan reservas `CONFIRMED`** (decidido), en la web, en el panel y en el backend. Una `PENDING` es una compra web con el pago iniciado pero sin confirmar: no hubo cobro, así que el reembolso simulado del 100 % no tiene sentido, y cancelarla compite con el evento del pago aprobado. Se resuelve sola: con el pago aprobado pasa a `CONFIRMED`, con el pago rechazado a `CANCELLED`, y si no llega nada, `Lifecycle` la deja `EXPIRED` a los 30 minutos y devuelve los cupos. Coincide con «anular una reserva confirmada» del contrato. Ningún flujo interno usa `CancelReservation` con una `PENDING`: la compensación de la compra, el pago rechazado y la expiración cambian el estado directamente, y las reservas de Booking nacen `CONFIRMED`.

## Cambios por módulo

### ms-booking: `src/application/cancellation-flow.ts`
- `assertBeforeCheckin` deja pasar solo `CONFIRMED`; `PENDING` responde `409` con el detalle del punto 3. La transición final pasa de `['PENDING', 'CONFIRMED']` a `['CONFIRMED']`.
- Constante `CANCELLATION_DEADLINE_HOURS = 24`.
- `assertDeadline(row, solicitante)`: trae el turno con `remote.slot(dis_id)` (`fecha`, `hora`). Si `zonedToUtc(fecha, hora) − ahora < 24 h`, lanza `AppError.conflict('CANCELLATION_DEADLINE_PASSED', …)`. No se aplica a `SAGA_ORCHESTRATOR`; sí a `CLIENTE` y `ADMIN`.
- Se llama en `cancel()` después de `assertBeforeCheckin`.
- Se actualiza el comentario de la clase.

### Plataforma: `packages/platform/src/problem-details.ts`
- `TITLES_BY_CODE.CANCELLATION_DEADLINE_PASSED = 'Cancelación Fuera de Plazo'`.

### Web (`AtraccionesService-web`)

| Archivo | Cambio |
|---|---|
| `src/utils/dates.ts` | `slotStart(date, time)`: lee la hora como la devuelve Booking (`10:30 a.m.`) o como `HH:mm`, en Ecuador (UTC-5 todo el año). `withinCancellationWindow(date, time)`: `true` si faltan 24 h o más. |
| `src/pages/ReservationDetailPage/index.tsx` | El botón «Cancelar reserva» aparece solo si la reserva está `CONFIRMED`, sin check-in y dentro del plazo. Si está confirmada pero falta menos de 24 h, en lugar del botón va el aviso «Cancelación no disponible (menos de 24h antes del inicio de la actividad). La política de cancelación gratuita aplica hasta 24h antes.». La etiqueta de check-in y los modales siguen igual; el modal de confirmación agrega «hasta 24 horas antes del turno». |
| `src/pages/admin/AdminOperationsPages.tsx` | «Cancelar» solo en `CONFIRMED` y con 24 h o más hasta el turno (también para el `ADMIN`). |
| `src/features/content/faq.ts`, `src/pages/HelpPage/index.tsx` | La política dice «hasta 24 horas antes del inicio del turno». |

### Documentación
- `apps/services/ms-booking/README.md`: «Solo antes del check-in (`PENDING` o `CONFIRMED`)» pasa a «Solo `CONFIRMED`», más la regla del plazo y el nuevo `409`.
- `Plan/PLAN_CANCELACION_CON_REEMBOLSO.md`: enlace a este plan.

### Sin cambios
Partner API (la ruta y el alias de cancelación ya existen, y el `409` pasa tal cual por el ESB), ms-inventory, ms-order, ms-refund, GraphQL, la base de datos y el check-in.

## Verificación
- `npm run build` (tsc) en la raíz y `npm run build` en `AtraccionesService-web`.
- En el navegador, sobre la página desplegada:
  - Una reserva confirmada para dentro de más de 24 h muestra «Cancelar reserva» y se cancela.
  - Una para dentro de menos de 24 h muestra el aviso, no el botón. Si se fuerza la llamada, responde `409` «Cancelación Fuera de Plazo».
  - Una `PENDING` no muestra el botón. Si se fuerza la llamada, responde `409 RESERVATION_NOT_CANCELLABLE`.
