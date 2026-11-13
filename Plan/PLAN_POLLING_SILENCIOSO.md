# Plan · Refresco silencioso en segundo plano (Silent Background Polling)

Solo frontend (`AtraccionesService-web`). No se tocan microservicios, contrato, tablas ni endpoints.

## Nombres del contrato (se respeta el v3)

El pedido menciona `GET /availability?date=...` y `available_spots`. En el contrato v3 y en el código son:

- `GET /atracciones/{id}/disponibilidad?date=YYYY-MM-DD` (`getAvailability` en `src/api/catalog.ts`).
- Campo `available_slots` y `status ∈ {DISPONIBLE, ULTIMOS_CUPOS, AGOTADO}` (`TimeSlot` en `src/types/attraction.ts`).
- Mis Reservas: `listMyReservations` (`src/api/bookings.ts`); estados `CHECKED_IN` (en el panel se muestra como `CONFIRMADO_ASISTIDO`) y `CANCELLED`.

Se usan los nombres del contrato; no se crea ningún endpoint nuevo.

## Situación actual

- `useAsync` (`src/hooks/useAsync.ts`) pone `status: 'loading'` en cada carga y `status: 'error'` si falla. No tiene recarga periódica.
- `ReservationHistory` (`src/components/profile/ReservationHistory/index.tsx`) solo muestra el skeleton cuando no hay datos. Un refresco no mostraría spinner, pero el array nuevo vuelve a pintar todas las filas.
- `AvailabilitySelector` muestra el skeleton siempre que `status === 'loading'`, aunque ya tenga datos. Un refresco haría parpadear los turnos.
- `BookingCard` guarda una **copia** del `TimeSlot` elegido (`slot.available_slots` decide si se habilita «Continuar»). Si los cupos cambian, esa copia queda desactualizada.
- `CheckoutPage` guarda solo `{ slotId, time }`, así que no sabe si el turno elegido se agotó. El formulario (react-hook-form) está fuera del selector.

## Diseño

### 1. Hook `usePolling` (nuevo, `src/hooks/usePolling.ts`)

Se monta sobre la misma idea de `useAsync`, pero con recarga periódica:

```ts
usePolling(load, deps, { intervalMs, enabled, merge })
// → { status, data, error, retry, refresh }
```

- **Primera carga** (o cambio de `deps`): igual que hoy, con `status: 'loading'`, para que la vista muestre su skeleton.
- **Consultas de fondo** (`isSilent = true`): nunca tocan `status` ni muestran un spinner. Si salen bien, actualizan `data`. Si fallan (red, 5xx o 429), se ignoran y se conserva lo último que se mostró. El error solo se muestra si falla la primera carga.
- **Sin solapes**: se usa una cadena de `setTimeout`, no `setInterval`. La siguiente consulta se programa cuando termina la anterior. Al desmontar o al cambiar `deps` se cancela con `AbortController`.
- **Pestaña oculta**: se pausa con `document.hidden`. Al volver a la pestaña se hace una consulta inmediata y se reanuda.
- **Diffing**: `merge(prev, next)` devuelve `prev` (la misma referencia) si no cambió nada. En ese caso no se llama a `setState` y React no vuelve a renderizar.

`useAsync` no cambia, así las otras pantallas siguen igual.

### 2. Utilidad de diffing (`src/utils/diff.ts`)

`mergeById(prevItems, nextItems, idOf, equal)`:
- Por cada elemento nuevo, si existe uno previo con el mismo id y `equal` lo da por igual, **reutiliza el objeto previo**.
- Si los elementos son los mismos, en el mismo orden y con las mismas referencias, devuelve el array previo.

Con eso, `React.memo` en la fila o el turno hace que solo se vuelva a pintar el que cambió.

### 3. Mis Reservas

- `useMyReservations` pasa a `usePolling`, con `intervalMs = 5000` y una comparación por `reservation_id` que mira `status` (y `updated_at` si viene).
- `ReservationRow` pasa a `React.memo`. Una tarjeta que no cambió no se vuelve a renderizar, así que no vuelve a pedir la orden ni parpadea.
- `key = reservation_id`, que ya es estable. La tarjeta no se desmonta: solo cambia el texto y el color del badge.
- **Badge suave**: `Badge` suma `transition-colors duration-300`.
- **Cancelada y Vencida en rojo `#b91c1c`**: ver la decisión 2.
- **Reservas que dejan de coincidir con el filtro**: se quedan visibles (decisión 4).
- Al cambiar la página o el filtro de estado, la carga sigue siendo normal (con skeleton). Las consultas de fondo usan la página y el filtro vigentes.

### 4. Turnos y aforo en vivo (`AvailabilitySelector`)

- `useAvailability` pasa a `usePolling` con `intervalMs = 3500` y una comparación por `slot_id` que mira `available_slots` y `status`.
- Skeleton solo si `status === 'loading' && !data`. En una consulta de fondo los turnos siguen en pantalla y solo cambia el número.
- **AGOTADO automático**: el estado se deduce en el cliente. Si `available_slots === 0`, el turno se trata como `AGOTADO` aunque el backend envíe otro `status`. Se deshabilita y muestra «Agotado». La regla de «menos cupos que boletos» se mantiene.
- Cada turno se separa en un subcomponente `SlotOption` memoizado, así solo se pinta el turno cuyo cupo cambió.
- **Prop nueva** `onSelectedSlotUpdate?(slot: TimeSlot)`: cuando cambian los datos del turno elegido, el selector avisa al padre. No toca nada más del estado del padre.

### 5. Sin reiniciar el formulario

- **`BookingCard`**: con `onSelectedSlotUpdate` actualiza su copia de `slot`. «Continuar» se habilita o deshabilita según los cupos en vivo. La fecha, los boletos y el calendario no cambian.
- **`CheckoutPage`**: guarda los cupos en vivo del turno elegido (`slotLive`) y deshabilita «Pagar» con un aviso si el turno se agota o ya no alcanza. Los datos del titular, la tarjeta y el cupón (react-hook-form) no se tocan: el selector se vuelve a renderizar por su cuenta y su `key={availabilityKey}` solo cambia ante un `409` de pago, como hoy.

### 6. Panel de administración (ampliación)

**Situación actual.** Todas las tablas del panel usan `AdminTable` (`src/pages/admin/AdminTable.tsx`, 19 pantallas), que carga
con `useAsync` y solo recarga al cambiar la página, los filtros o `reloadKey`. Una cancelación hecha desde Booking (o desde
otra sesión) no aparece hasta salir y volver a entrar. `AdminReservationsPage` además programa una recarga única a los 4 s
(`NOTICE_REFRESH_MS`) para ver si el aviso a Booking ya se envió. `AdminCheckinPage` muestra una reserva buscada y no la
vuelve a consultar.

**Cambios.**

- **`AdminTable`**: prop opcional `pollMs?: number` y `rowEqual?: (a: T, b: T) => boolean`. Con `pollMs`, la tabla usa
  `usePolling` en lugar de `useAsync`; sin ella, todo sigue igual en las demás pantallas.
  - Primera carga y cambios de página, búsqueda, filtros o `reloadKey`: carga normal, como hoy (skeleton o tabla al 60 %).
  - Consultas de fondo: silenciosas, sin opacidad ni skeleton; un fallo se ignora y se conserva la última tabla.
  - `merge` con `mergeById(rowKey, rowEqual)`: si nada cambió, no se vuelve a pintar. Las filas se separan en un `AdminRow`
    memoizado, así solo se repinta la fila que cambió; el `Badge` ya tiene `transition-colors`.
  - Se actualiza también el total de resultados.
  - Si cambia la página mientras corre una consulta de fondo, esa consulta se cancela (ya lo hace `usePolling`).
- **`AdminReservationsPage`** (Reservas): `pollMs = 5000` y `rowEqual` por `status`, `notificacion_booking` y `guia_asignado`.
  - Se quita la recarga de 4 s (`NOTICE_REFRESH_MS` y `noticeTimer`): el polling ya muestra cuando el aviso pasa a «Enviado».
  - Los botones «Confirmar Asistencia» y «Cancelar» dependen de `status`, así que desaparecen solos si Booking cancela.
  - Si un modal de check-in o cancelación está abierto y la reserva cambia, el modal no se cierra; el backend responde `409`
    y se muestra el error que ya existe («La reserva no está confirmada…»).
- **`AdminCheckinPage`** (página de check-in): con una reserva elegida, se vuelve a consultar en segundo plano cada 5 s
  (`getReservation`, el mismo que ya usa «Actualizar aviso»). Si cambian `status` o `notificacion_booking`, se actualiza la
  reserva mostrada; si no, no se vuelve a pintar.
  - Si Booking la cancela, el formulario se reemplaza por el aviso que ya existe («Esta reserva está en estado Cancelada…»).
  - Mientras siga `CONFIRMED`, el formulario no se desmonta (`key` por `reservation_id`): lo escrito no se pierde.
  - Después de un check-in, el aviso a Booking pasa a «Enviado» solo; el botón «Actualizar aviso» se mantiene.
  - Un fallo de fondo se ignora; al buscar otra reserva o limpiar la búsqueda, el polling se detiene o cambia de reserva.
- **`usePolling`**: `intervalMs` en `0` desactiva las consultas de fondo (se comporta como `useAsync`), para que
  `AdminTable` use un solo hook con o sin `pollMs`.
- **Filtro de estado**: ver la decisión 7.
- **Alcance en el panel**: ver la decisión 8.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/hooks/usePolling.ts` | Nuevo |
| `src/utils/diff.ts` | Nuevo (`mergeById`) |
| `src/features/attractions/slots.ts` | Nuevo (`isSoldOut`, `slotUnavailable`), compartido por el selector, `BookingCard` y `CheckoutPage` |
| `src/hooks/useReservations.ts` | `useMyReservations` con polling de 5 s |
| `src/hooks/useAttractions.ts` | `useAvailability` con polling de 3,5 s |
| `src/components/profile/ReservationHistory/index.tsx` | `ReservationRow` memoizado |
| `src/components/profile/StatusBadge.tsx` | `CANCELLED` y `EXPIRED` con el tono `cancelled` (portal y panel) |
| `src/components/common/Badge/index.tsx` | `transition-colors` y tono `cancelled` (`#b91c1c`) |
| `src/components/reservation/AvailabilitySelector/index.tsx` | Skeleton solo en la primera carga, `SlotOption` memoizado, AGOTADO al llegar a 0, `onSelectedSlotUpdate` |
| `src/components/attractions/BookingCard.tsx` | Sincroniza el turno elegido |
| `src/pages/CheckoutPage/index.tsx` | Cupos en vivo del turno elegido y bloqueo de «Pagar» si se agota |
| `src/pages/admin/AdminTable.tsx` | `pollMs` y `rowEqual` opcionales, `usePolling` con `mergeById`, `AdminRow` memoizado (ampliación) |
| `src/pages/admin/AdminOperationsPages.tsx` | Reservas con polling de 5 s; se quita la recarga única de 4 s (ampliación) |
| `src/pages/admin/AdminCheckinPage.tsx` | La reserva elegida se consulta cada 5 s (ampliación) |
| `src/hooks/usePolling.ts` | `intervalMs = 0` sin consultas de fondo (ampliación) |

Verificación: `tsc` y una prueba en el navegador real con dos sesiones (una reserva o cancela y la otra ve el cambio). Sin pruebas automatizadas.

## Decisiones

1. **Etiquetas de Mis Reservas** (decidido): no cambian. El cliente sigue viendo «Check-in hecho», «Cancelada», etc. `CONFIRMADO_ASISTIDO` sigue siendo solo del panel.
2. **Rojo `#b91c1c`** (decidido): para `CANCELLED` (Cancelada) y `EXPIRED` (Vencida), en el portal y en el panel de administración. Como `AdminReservationStatusBadge` toma `CANCELLED` y `EXPIRED` de la misma tabla `RESERVATION`, el cambio en esa tabla cubre las dos vistas. Se agrega un tono `cancelled` a `Badge` (`bg-[#FEE2E2] text-[#b91c1c]`), así no cambia el tono `danger` de órdenes y pagos.
3. **Turno elegido que se agota** (decidido): no se deselecciona. Queda marcado (con el borde de selección) y con el texto «Agotado» (o «Solo N cupos» si ya no alcanzan para los boletos). «Continuar» (`BookingCard`) y «Pagar» (`CheckoutPage`) quedan deshabilitados y aparece el aviso: «El horario elegido se agotó (o ya no tiene cupos suficientes). Elige otro horario para continuar.» Si vuelven a liberarse cupos, el aviso desaparece y el botón se habilita solo. Como hoy el radio de un turno agotado está `disabled`, el turno elegido queda marcado aunque esté agotado, pero no se puede volver a elegir uno agotado.
4. **Filtro de estado** (decidido): la reserva que cambia de estado **se queda visible** con su badge nuevo (por ejemplo, rojo de Cancelada) aunque ya no coincida con el filtro. En las consultas de fondo, `merge` actualiza las reservas que ya están en la lista y no quita las que dejaron de venir. Las reservas nuevas que traiga el servidor se agregan. La lista se reemplaza completa solo con una carga normal (cambio de página o de filtro, o al volver a entrar a la pestaña).
5. **Alcance** (decidido): solo el listado de Mis Reservas. `ReservationDetailPage` no cambia.
6. **Intervalos** (decidido): 5 s para Mis Reservas y 3,5 s para turnos, en pausa mientras la pestaña está oculta.
7. **Filtro de estado en el panel** (decidido): igual que en Mis Reservas (decisión 4). Con el filtro «Confirmada», una
   reserva que Booking cancela se queda visible en rojo hasta cambiar de página o de filtro (`keepMissing`).
8. **Alcance en el panel** (decidido): la tabla de Reservas y la reserva que se muestra en la página de check-in. Órdenes,
   pagos, reembolsos y las demás tablas siguen sin polling.
