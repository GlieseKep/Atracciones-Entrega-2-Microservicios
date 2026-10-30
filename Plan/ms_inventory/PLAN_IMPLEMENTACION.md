# Plan de implementación · ms_inventory (Inventory & Availability Service, gRPC)

| | |
|---|---|
| Microservicio | 7 · Inventory & Availability Service |
| Protocolo | gRPC sobre HTTP/2 (detrás del ESB) |
| Clasificación (arquitectura_esb_v3) | Asíncrono: publica `CupoBloqueado` y `CupoLiberado` al bus. |
| Contrato | [inventory.proto](inventory.proto) |
| Contratos externos | `GET /atracciones/{id}/disponibilidad` de `atracciones-openapi-v3(1).yaml`; `Plan/PlanBooking/inventory.proto` (stock hacia Booking Prototipo) |
| Base de datos | [ms_inventory.sql](ms_inventory.sql) → base `ms_inventory` |
| Ref. externas | `atr_codigo` (Catalog) |
| Puerto local propuesto | `GRPC_PORT=50067` |

## 1. Objetivo

Programar el servicio dueño de los turnos y del aforo:

- horarios, turnos con `slot_id` y fechas bloqueadas;
- consulta de disponibilidad del contrato v3;
- descuento atómico de cupos, sin sobreventa, y su reintegro al cancelar;
- envío de cada cambio de cupo a Booking Prototipo por gRPC, puerto 50051.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 7 de `02_microservicios_v2_bases_de_datos.sql` | `horario`, `disponibilidad`, `fecha_bloqueada`. `dis_slot_codigo` es el `slot_id`. El estado se calcula: `ULTIMOS_CUPOS` con 3 o menos, y no se guarda |
| `arquitectura_esb_v3.html` | El ESB traduce la disponibilidad de REST a gRPC. Booking descuenta cupos por `slot_id` y los reintegra al cancelar. Inventory envía `PushStockUpdate` y `StreamInventoryChanges` en cada cambio. Publica `CupoBloqueado` y `CupoLiberado` |
| Contrato v3 | `DisponibilidadResponse` y `TimeSlotItem`. Sección 2: gRPC es obligatorio para el stock; la reserva descuenta con bloqueo transaccional ACID |
| `Plan/PlanBooking/inventory.proto` | Servicio `inventory.InventoryStockService`, con `slot_id` y `timestamp` monotónico |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| `atr_codigo CHAR(12)` reemplaza a `atr_id` | El contrato pide la disponibilidad por el `id` alfanumérico, y `item_id` del gRPC también lo usa |
| Tabla `bloqueo_cupo` | Sin ella, un reintento de la saga descontaría los cupos dos veces |
| Tabla `outbox` | La arquitectura exige publicar eventos y enviar el stock sin perderlo |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **`price_adult` y `price_child`.** Son opcionales en `TimeSlotItem`, Inventory no guarda precios y la arquitectura no tiene llamada
   a Pricing. No se envían; el precio se obtiene de Catalog y Pricing.
2. **Generación de turnos.** `horario` no tiene día de la semana: cada horario activo genera un turno diario para los
   próximos 90 días, con un proceso periódico, saltando las fechas bloqueadas.
3. **`service_id`.** El `.proto` pide el código de la tienda: la variable `BOOKING_SERVICE_ID`, con valor `NODE_ATR_DILAN`.
4. **Push o stream.** `PushStockUpdate` para cada venta o cancelación, y `StreamInventoryChanges` para cambios en lote,
   como la generación de turnos.
5. **Booking Prototipo no responde.** El evento queda en `outbox` y se reintenta; la venta no se revierte. Si responde
   `STALE_TIMESTAMP_IGNORED`, se da por enviado.
6. **Atracción desconocida.** Inventory no consulta a Catalog: sin ningún horario → `404`; con horarios y sin turnos
   ese día → `200` con lista vacía.
7. **Turnos no ofrecidos.** El contrato solo tiene tres estados: los turnos cerrados o cuya hora ya pasó no se listan.
8. **Fecha bloqueada.** Es un día en que la atracción no opera: la fecha comparada es la de la actividad (`dis_fecha`), nunca la de
   la compra. El usuario no puede elegir ese día, pero sí comprar cualquier otro día no bloqueado, aunque la compra se haga en la
   fecha bloqueada. El bloqueo no depende de que un operador intervenga en cada compra: lo define el operador con su cuenta (o el
   `ADMIN`) y el sistema lo aplica solo. Bloquear cierra los turnos de ese día con `dis_cerrada` sin borrarlos;
   desbloquear los reabre. Si ya hay reservas, siguen vigentes y el `ADMIN` las gestiona tras el aviso del operador.
9. **Reducir aforo.** `dis_cupo_total` no puede quedar por debajo de `dis_cupo_reservado` (`409 CAPACITY_BELOW_RESERVED`).
10. **Horarios.** `ON DELETE CASCADE` borraría los turnos: no hay borrado; se desactiva con `hor_activo`. Desactivar deja
    de generar turnos, sin tocar los existentes.
11. **`turnos_aforo`.** El contrato nombra `schema_atracciones.turnos_aforo`; el script general dice que `disponibilidad` hace ese
    papel. Se sigue el script.

## 4. Estructura del servicio (`apps/services/ms-inventory`)

```
apps/services/ms-inventory/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          gRPC, generador de turnos y publicador del outbox
    app.ts                           configuración y manejadores gRPC
    contract.ts                      tipos del contrato
    application/
      availability.ts                estado del turno y DisponibilidadResponse
      slot-generator.ts              turnos a partir de los horarios
      seat-service.ts                descuento y reintegro de cupos
      schedule-service.ts            horarios, aforo y fechas bloqueadas
      booking-stock-sync.ts          PushStockUpdate y StreamInventoryChanges
      input.ts                       validación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      inventory-client.ts            cliente para los demás componentes
      booking-stock-client.ts        cliente gRPC de inventory.InventoryStockService
    persistence/
      data-source.ts
      availability-repository.ts
      seat-repository.ts
      schedule-repository.ts
      migrations/
        index.ts
        <timestamp>-InventorySchema.ts      DDL de ms_inventory.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 4 programadas en `apps/services/ms-inventory`; compila y los `.proto` cargan. Sin pruebas. Falta la Fase 5, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar `inventory.proto` a `packages/contracts/proto/` y `Plan/PlanBooking/inventory.proto` como contrato externo.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL completo de `ms_inventory.sql`.
- [x] `AvailabilityRepository`: turnos por atracción y fecha.
- [x] `SeatRepository`:
  - **Descontar:** en una transacción, insertar en `bloqueo_cupo` y ejecutar
    `UPDATE disponibilidad SET dis_cupo_reservado = dis_cupo_reservado + $n WHERE ... AND NOT dis_cerrada AND dis_cupo_reservado + $n <= dis_cupo_total`.
    Sin filas actualizadas → `409 OUT_OF_STOCK`.
  - **Clave repetida:** devuelve el resultado anterior sin descontar.
  - **Reintegrar:** marca `blo_liberado_en` una sola vez y resta los cupos.
- [x] `ScheduleRepository`: horarios, turnos y fechas bloqueadas.

### Fase 2 · API gRPC
- [x] **`GetAvailability`:** responde con los nombres de `DisponibilidadResponse`, incluidos los alias en español. `status` se calcula:
      `AGOTADO` con 0 cupos, `ULTIMOS_CUPOS` con 3 o menos, y `DISPONIBLE` en otro caso.
- [x] `time` en formato `10:30 a.m.` y `time_24h` en `10:30:00`.
- [x] **`FilterAvailableAttractions`:** para el filtro de fechas de Catalog.
- [x] **`ReserveSeats`:** un `slot_id` que no existe en esa atracción → `400 SLOT_TIME_MISMATCH`, como indica el contrato.
- [x] **`ReleaseSeats`:** idempotente.
- [x] **`GetSlotsByIds`:** Booking lee aquí la fecha, la hora y el `slot_id` de sus reservas.
- [x] Administración con permisos de `ADMIN`, u `OPERADOR` de la atracción.
- [x] `Health` con los campos de `NodeHealthResponse`.

### Fase 3 · Turnos y eventos
- [x] Generador de turnos: `INSERT ... ON CONFLICT DO NOTHING`, con `dis_slot_codigo` = `slot-YYYYMMDD-HHMM`.
- [x] `CupoBloqueado` y `CupoLiberado` en `outbox`, en la misma transacción que el cambio de cupos.

### Fase 4 · Stock hacia Booking Prototipo
- [x] Cliente de `inventory.InventoryStockService`, host en `BOOKING_STOCK_GRPC` (local: `localhost:50051`).
- [x] `PushStockUpdate` con `service_id`, `item_id`, `date`, `time_slot`, `available_units`, `timestamp` en milisegundos y `slot_id`.
- [x] `StreamInventoryChanges` para los lotes, con `event_id` UUID v4 y `delta`.
- [x] Reintentos según la decisión 5.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `inventory.*`.
- [ ] **API Gateway / Partner API:** exponer `GET /atracciones/{id}/disponibilidad`.
- [ ] **Catalog:** usar `FilterAvailableAttractions`.
- [ ] **Booking:** usar `ReserveSeats` y `ReleaseSeats`, con `ord_numero` en la clave de idempotencia.
- [ ] **GraphQL:** horarios, turnos y fechas bloqueadas en el panel.

## 6. Criterios de aceptación

- `GET /atracciones/{id}/disponibilidad` cumple `DisponibilidadResponse`, y `total_available_slots` es la suma de los turnos.
- Dos compras simultáneas del último cupo: una pasa y la otra recibe `409 OUT_OF_STOCK`.
- Repetir `ReserveSeats` o `ReleaseSeats` con la misma clave no cambia los cupos.
- Toda venta o cancelación llega a Booking Prototipo por `PushStockUpdate`, aunque esté caído un tiempo.
- Ningún turno se ofrece en una fecha bloqueada, y durante esa fecha se pueden seguir comprando turnos de otros días.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Booking Prototipo caído | El evento queda en `outbox`; `timestamp` monotónico evita aplicar datos viejos |
| El `.proto` de Booking marca `ULTIMOS_CUPOS` con ≤ 5, y el contrato REST con ≤ 3 | Inventory usa 3 en su ruta REST y envía `available_units`; Booking calcula su propio estado |
| Generador caído | La ventana de 90 días da margen, y el generador rellena al volver |
| Muchas consultas de disponibilidad | Índices por atracción y fecha; la arquitectura prevé read models para consultas masivas |
