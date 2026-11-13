# Plan · Check-in permitido hasta el día del turno

| | |
|---|---|
| Pedido | Quitar la regla «check-in solo el día del turno». Se permite antes y el mismo día; después de la fecha del turno, no. |
| Reemplaza | La sección «Corrección: check-in solo el día del turno» de `PLAN_CANCELACION_SIN_REEMBOLSO.md` |
| Contrato v3 | No define reglas de fecha para el check-in: el cambio no lo contradice |

## Regla nueva

- `slot.fecha >= hoy` → se permite el check-in (cualquier día anterior y el mismo día, a cualquier hora).
- `slot.fecha < hoy` → `409 CHECKIN_OUT_OF_DATE`, «El turno de esta reserva ya pasó (fecha)».
- «Hoy» es la fecha de negocio (`America/Guayaquil`, `todayIn()`), igual que ahora.

## Cambios

### Backend · ms-booking

1. **`src/application/checkin-service.ts`**, en `checkIn()`: cambiar `slot.fecha !== today` por `slot.fecha < today` y dejar
   solo el mensaje «ya pasó». Actualizar el comentario.
2. **`src/persistence/reservation-repository.ts` y `src/application/lifecycle.ts`**: hoy `Lifecycle` pasa `CHECKED_IN` →
   `COMPLETED` según el día de `res_checkin_en`. Con check-in adelantado, la reserva quedaría `COMPLETED` al día siguiente
   del check-in, **antes de la actividad**. Se cambia para usar la fecha del turno, como ya hace `expireNoShows`:
   traer las `CHECKED_IN` (`byState('CHECKED_IN', 0)`), pedir sus turnos con `remote.slots(...)` y completar solo las que
   tengan `slot.fecha < hoy`. `checkedInBefore` deja de usarse y se elimina.
3. **`README.md`**: secciones «Check-in» y del ciclo de estados con la regla nueva.

### Partner API

4. **`apps/partner-api/src/handlers/reservations.ts`**: solo el comentario de `checkIn` («solo el día del turno» →
   «hasta el día del turno»). El `409` llega al socio igual que ahora.

### Web · AtraccionesService-web

5. **`src/utils/dates.ts`**: `isCheckinDay` pasa a `canCheckIn(fecha) = fecha >= todayInEcuador()` (comparación de
   cadenas `YYYY-MM-DD`).
6. **`src/pages/admin/AdminOperationsPages.tsx`**: el botón «Confirmar Asistencia» usa `canCheckIn`; se corrige el comentario.
7. **`src/pages/admin/AdminCheckinPage.tsx`**: el formulario aparece si `canCheckIn`; el aviso queda solo para turnos
   pasados («El turno de esta reserva fue el dd/mm: ya no se puede hacer el check-in»).
8. **`src/pages/admin/CheckinForm.tsx`**: el mapa de mensajes tiene `CHECKIN_OUT_OF_WINDOW`, pero el backend devuelve
   `CHECKIN_OUT_OF_DATE`; se agrega ese código con «El turno de esta reserva ya pasó: no se puede hacer el check-in».

## Consecuencia a tener en cuenta

Con el check-in adelantado, la reserva pasa a `CHECKED_IN` y **ya no se puede cancelar** (la cancelación exige
`CONFIRMED`), aunque falten más de 24 horas para el turno. Este plan lo deja así, porque es la regla que existe hoy
(«después del check-in el servicio ya inició y no se cancela»).

## Fuera de alcance

- Sin pruebas (solo compilar con `tsc`).
- No se toca `apps/services/booking` (servicio viejo, fuera del launcher).
