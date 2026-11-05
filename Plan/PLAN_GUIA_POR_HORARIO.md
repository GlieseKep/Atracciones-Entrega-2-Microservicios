# Plan · Asignar el guía al crear los horarios (y cambiarlo por día)

| | |
|---|---|
| Fecha | 2026-11-05 |
| Origen | `AUDITORIA_PANEL_ADMIN.md` §2.9 y §5 (reparto de guías) |
| Servicios | ms-inventory (guarda el guía), ms-booking (lo usa en la compra), ms-catalog (valida el guía), GraphQL/ESB, panel administrativo |

## 1. Qué dice el contrato v3

El contrato (`Plan/PlanBooking/atracciones-openapi-v3(1).yaml`) **no especifica cómo se asigna el guía**. Solo define:

| Campo | Dónde | Qué es |
|---|---|---|
| `guia_asignado` | `ReservaConfirmadaResponseV2` y `CheckinResponse` | Nombre del guía de la experiencia (ej. `Lic. Carlos Morales (Credencial Mintur #5541)`) |
| `guia_codigo` | `CheckinRequest` | Código del guía que valida el check-in (ej. `GUIA-CARLOS-01`) |

La guía de socios (`GUIA_INTEGRACION_SOCIOS(1).md`) solo muestra `guia_asignado` en el ejemplo de reserva. Por tanto,
la asignación es una decisión interna y **no cambia el contrato con Booking**: `guia_asignado` sigue siendo el nombre.

## 2. Situación actual

- `guia` vive en ms-catalog: pertenece a un operador y puede no tener cuenta (`usu_id` opcional).
- ms-inventory tiene `horario` (atracción + hora + cupo, vale para todos los días) y `disponibilidad` (el turno de cada
  fecha, generado desde el horario para los próximos 90 días). Ninguno tiene guía.
- En la compra, Booking pide a Catalog `getLogistics` sin guía y Catalog devuelve **el primer guía activo del operador**
  (`guides.forReservation`, el de menor `gui_id`). Booking guarda ese `gui_id` en la reserva.
- Resultado: con varios guías por operador, todas las reservas recaen en el mismo.

## 3. Diseño propuesto

Dos niveles, los dos en ms-inventory (dueño de horarios y turnos):

| Nivel | Tabla | Uso |
|---|---|---|
| **Guía del horario** | `horario.gui_id` | Se elige al crear o editar el horario. Es el guía por defecto de todos los turnos que genera |
| **Guía del turno** | `disponibilidad.gui_id` | Copia del guía del horario al generarse el turno. Se puede cambiar para un día concreto (por ejemplo, el lunes Carlos y el martes Ana) |

Reglas:

1. `gui_id` es un **ID lógico de Catalog** (sin FK, como `atr_codigo`). `NULL` = sin guía: en la compra se mantiene el
   comportamiento actual (Catalog elige el primero activo del operador).
2. Al **crear** un horario con guía, los turnos nuevos nacen con ese guía.
3. Al **cambiar el guía del horario**, se actualizan los turnos **futuros** que aún tenían el guía anterior. Los días que
   se cambiaron a mano (guía distinto al del horario) se conservan.
4. Al cambiar el guía de **un turno**, solo cambia ese día. Enviar `gui_id = 0` lo devuelve al guía del horario.
5. **Rango de fechas:** se puede asignar un guía a todos los turnos de una atracción entre `desde` y `hasta` (ambas
   inclusive) de una vez. Filtros opcionales: un horario concreto (`hor_id`) y días de la semana (`dias_semana`, 1 = lunes
   … 7 = domingo; vacío = todos). Ejemplo: «Ana, del 1 al 30 de diciembre, solo sábados y domingos, horario de las 09:00».
   - Solo afecta a turnos **existentes** con `dis_fecha >= hoy` (no se cambia el pasado). Los turnos se generan 90 días
     hacia adelante, así que `hasta` no puede pasar de hoy + 90 días (`RANGE_BEYOND_WINDOW`, 400).
   - `desde` debe ser hoy o posterior y no mayor que `hasta` (400 `VALIDATION_ERROR`); el rango máximo es de 90 días.
   - `gui_id = 0` devuelve los turnos del rango al guía de su horario.
   - Pisa los cambios de días sueltos que haya dentro del rango (es la intención de asignar en bloque).
   - Todo en una transacción y validando el guía una sola vez. Responde cuántos turnos cambiaron y la lista de `slot_id`.
   - Los turnos que se generen después dentro del rango (por ejemplo, si se reactiva un horario) nacen con el guía del
     horario, no con el del rango: el panel lo advierte al reactivar.
6. Inventory **valida** el guía con Catalog antes de guardarlo: `catalog.getLogistics { id: <atracción>, gui_id }`.
   Responde 404 `GUIDE_NOT_FOUND` si el guía no existe, está inactivo o es de otro operador.
7. Las reservas ya hechas **no cambian** de guía: el guía queda en `reserva.gui_id` (Booking) al comprar. Al asignar un
   rango con turnos que ya tienen reservas, el panel lo advierte («N reservas mantienen su guía actual»).
8. Si se desactiva un guía en Catalog, los turnos que lo tenían siguen apuntándole; en la compra Booking lo detecta
   (Catalog responde 404) y usa el primer guía activo del operador. El panel avisa de los turnos con guía inactivo.

## 4. Cambios por componente

### 4.1 Diseño de base de datos

En `Plan/02_microservicios_v2_bases_de_datos.sql` y `Plan/ms_inventory/ms_inventory.sql`:

```sql
-- horario
    gui_id     BIGINT,                              -- ID logico (Catalog): guia por defecto de los turnos; NULL = sin guia
-- disponibilidad
    gui_id             BIGINT,                      -- ID logico (Catalog): guia del turno; NULL = sin guia
CREATE INDEX ix_disponibilidad_gui_id ON disponibilidad (gui_id);
```

### 4.2 ms-inventory

| Pieza | Cambio |
|---|---|
| Migración | `1796000000510-InventoryGuides.ts`: `ALTER TABLE horario ADD COLUMN gui_id BIGINT`, `ALTER TABLE disponibilidad ADD COLUMN gui_id BIGINT` y el índice; registrarla en `migrations/index.ts` |
| Proto (`Plan/ms_inventory/inventory.proto` y `packages/contracts/proto/internal/ms-inventory.proto`) | `SaveScheduleRequest.gui_id = 5` (0 = sin guía); `Schedule.gui_id = 6`; `Slot.gui_id = 9`; `ReserveSeatsResponse.gui_id = 4`; RPC nuevos `SetSlotGuide (SetSlotGuideRequest { atraccion_id, slot_id, gui_id }) returns (Slot)` y `SetSlotsGuide (SetSlotsGuideRequest { atraccion_id, desde, hasta, int64 hor_id (0 = todos), repeated int32 dias_semana, gui_id }) returns (SlotsGuideResult { int32 actualizados, repeated string slot_ids, int32 con_reservas })` |
| `contract.ts` | `gui_id: number \| null` en `Schedule`, `Slot` y `ReserveSeatsResponse` |
| `input.ts` | `parseGuideId`: ausente o 0 → `null`; entero positivo → número |
| `ScheduleRepository` | Leer y devolver `gui_id` en horarios y turnos. `createSchedule(…, guiId)`. `updateSchedule(id, cupo, guiId, hoy)`: en una transacción actualiza el horario y los turnos con `dis_fecha >= hoy` cuyo `gui_id IS NOT DISTINCT FROM` el guía anterior. `generateSlots` copia `h.gui_id`. `setSlotGuide(codigo, slot, guiId)`: con `null`, toma el guía del horario. `setSlotsGuide(codigo, desde, hasta, horId, dias, guiId, hoy)`: un solo `UPDATE disponibilidad d SET gui_id = COALESCE($guia, h.gui_id) FROM horario h WHERE h.hor_id = d.hor_id AND d.atr_codigo = $1 AND d.dis_fecha BETWEEN greatest($desde, hoy) AND $hasta AND ($hor = 0 OR d.hor_id = $hor) AND (cardinality($dias) = 0 OR extract(isodow FROM d.dis_fecha) = ANY($dias)) RETURNING d.dis_slot_codigo, d.dis_cupo_reservado > 0` |
| `SeatRepository.reserve` | Devolver el `gui_id` del turno (también en la respuesta idempotente repetida) |
| `ScheduleService` | `save(…, guiId)`, `setSlotGuide(…)` y `setSlotsGuide(…)`: `requireStaff` + validación del guía con Catalog (regla 6) + validación del rango (regla 5) |
| `input.ts` (rango) | `parseWeekdays`: lista de enteros 1–7 sin repetidos (vacía = todos) |
| `app.ts` | `SaveSchedule` pasa `gui_id`; RPC `SetSlotGuide` y `SetSlotsGuide` |
| ESB (`esb-routes.ts`) | `'inventory.setSlotGuide': route('SetSlotGuide', 5000)` y `'inventory.setSlotsGuide': route('SetSlotsGuide', 10000)` (consultan a Catalog; el rango actualiza hasta ~90 turnos por horario). Subir `SaveSchedule` no hace falta: ya tiene 10 s |

### 4.3 ms-booking (compra)

En `purchase-flow.ts`, después de `reserveSeats`:

1. Si `seats.gui_id` tiene valor → `remote.logisticsOrNull(attraction.id, seats.gui_id)`.
2. Si devuelve logística, se usa esa (guía del turno); si es `null` (guía inactivo), se usa la que ya se pidió sin guía.
3. Esa consulta va dentro del bloque que deshace cupos y orden si algo falla.
4. `save` guarda `logistics.guia.gui_id` y `pay` responde con la misma logística, así `guia_asignado` es el del turno.

`remote.reserveSeats` añade `gui_id` a su tipo de respuesta. No cambian `ReservaResponse` ni el contrato v3.

### 4.4 GraphQL

`apps/graphql/src/operations.ts`: `m('inventory', 'setSlotGuide')` y `m('inventory', 'setSlotsGuide')`. `inventorySaveSchedule`, `inventoryListSchedules` e
`inventoryListSlots` ya existen y pasan a llevar `gui_id`.

### 4.5 Panel administrativo (Disponibilidad)

| Pantalla | Cambio |
|---|---|
| Horarios de una atracción | Selector **Guía** al crear o editar (guías activos del operador de la atracción: `catalogListGuides { operador, activo: true }`), con la opción «Sin guía» |
| Turnos (calendario o lista por fechas) | Columna **Guía** por turno y acción «Cambiar guía de este día» (`inventorySetSlotGuide`), y «Volver al guía del horario» (`gui_id: 0`) |
| Asignar por rango | Botón «Asignar guía a un rango»: guía, desde, hasta, horario (todos o uno) y días de la semana. Antes de confirmar muestra cuántos turnos cambiarán (con `inventoryListSlots` del rango) y cuántos tienen reservas; después, el resultado de `inventorySetSlotsGuide` |
| Avisos | Turnos con guía inactivo o sin guía cuando la atracción incluye guía (`incluye_guia`) |
| Reservas | La columna «Guía» sigue mostrando `guia_asignado` de Booking |

## 5. Orden de trabajo

1. Diseño SQL y protos.
2. ms-inventory: migración, repositorios, servicio, RPC y ruta del ESB.
3. ms-booking: guía del turno en la compra.
4. GraphQL: `inventorySetSlotGuide` e `inventorySetSlotsGuide`.
5. Compilar con `tsc` (ms-inventory, ms-booking, ESB, GraphQL) y desplegar.
6. Panel: selector de guía en horarios y por turno (dentro de la reprogramación del panel).

## 6. Comprobación tras desplegar

1. `inventorySaveSchedule { hor_id: 0, atraccion_id, hora: "09:00", cupo: 20, gui_id: <Carlos> }` → los turnos nuevos
   salen con `gui_id` de Carlos en `inventoryListSlots`.
2. `inventorySetSlotGuide { atraccion_id, slot_id: <martes>, gui_id: <Ana> }` → solo ese turno cambia.
3. Comprar el lunes y el martes → `guia_asignado` = Carlos y Ana, respectivamente.
4. Cambiar el guía del horario a Luis → los turnos futuros de Carlos pasan a Luis; el martes sigue con Ana.
5. `inventorySetSlotsGuide { atraccion_id, desde: <1 dic>, hasta: <31 dic>, dias_semana: [6, 7], gui_id: <Ana> }` →
   `actualizados` = sábados y domingos de diciembre (por cada horario); los días entre semana no cambian.
6. Mismo rango con `gui_id: 0` → esos turnos vuelven al guía de su horario.
7. `hasta` a más de 90 días → 400 `RANGE_BEYOND_WINDOW`; `gui_id` de un guía de otro operador → 404 `GUIDE_NOT_FOUND`.

## 7. Decisiones pendientes

| Tema | Propuesta |
|---|---|
| Un guía en dos turnos que se cruzan | No se valida (Inventory no conoce la duración). Se puede avisar en el panel comparando horas y duración de la atracción |
