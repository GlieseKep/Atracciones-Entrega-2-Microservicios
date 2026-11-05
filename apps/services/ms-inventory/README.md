# ms-inventory · Inventory & Availability Service (HTTP interno)

Horarios, turnos, aforo y fechas bloqueadas. Descuenta cupos sin sobreventa y envía cada cambio a Booking Prototipo.

- Contrato: [`Plan/ms_inventory/inventory.proto`](../../../Plan/ms_inventory/inventory.proto), copiado en `packages/contracts/proto/internal/ms-inventory.proto`
- Contrato externo: [`Plan/PlanBooking/inventory.proto`](../../../Plan/PlanBooking/inventory.proto), copiado en `packages/contracts/proto/booking/inventory.proto`
- Base de datos: `ms_inventory` ([`Plan/ms_inventory/ms_inventory.sql`](../../../Plan/ms_inventory/ms_inventory.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_inventory/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_inventory/PLAN_IMPLEMENTACION.md)

## Reglas

- Cada horario activo genera un turno diario para los próximos 90 días, saltando las fechas bloqueadas.
- `status`: `AGOTADO` con 0 cupos, `ULTIMOS_CUPOS` con 3 o menos, `DISPONIBLE` en otro caso. No se guarda.
- Los turnos cerrados o cuya hora ya pasó no se listan.
- Una fecha bloqueada se compara con la fecha de la actividad, nunca con la de compra. Bloquear cierra los turnos del día sin borrarlos; desbloquear los reabre.
- Los horarios no se borran ni cambian de hora: se desactivan y se crea otro.

## Cupos

`ReserveSeats` y `ReleaseSeats` son idempotentes por `clave_idempotencia`. El descuento es un `UPDATE` condicionado: sin cupos no toca filas y responde `409 OUT_OF_STOCK`.

## Permisos

La administración es para `ADMIN`, u `OPERADOR` de la atracción. Para un `OPERADOR`, Inventory consulta `catalog.adminGetAttraction` por el ESB con el principal propagado.

## Eventos y stock

- **Bus:** `inventory.CupoBloqueado` e `inventory.CupoLiberado`, por `OutboxRelay`.
- **Booking Prototipo:** filas `STOCK_BOOKING` del mismo outbox, que entrega `BookingStockSync` por `POST /api/v3/inventory/stock` con `X-API-Key`. No van al bus, para que una caída de Booking no frene los eventos.
- `PushStockUpdate` para cada venta, cancelación o cambio de aforo; `StreamInventoryChanges` para los lotes del generador.
- `STALE_TIMESTAMP_IGNORED` cuenta como entregado. `ITEM_NOT_FOUND` (Booking aún no conoce la atracción) se reintenta cada minuto durante 30 minutos, sin frenar a las demás atracciones. `INVALID_SLOT` se registra y no se reintenta.
- Editar el cupo de un horario lo aplica a los turnos futuros que aún tenían el anterior. Catalog pide `ResendStock` al publicar (saldo real) y al retirar o eliminar (0 cupos).
- Cada envío deja en el log `STOCK_EMITIDO` o `STOCK_FALLIDO`, con `transporte: rest`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_INVENTORY_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `InventoryClient` (`src/integration/inventory-client.ts`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-inventory
INTERNAL_TOKEN_SECRET=... SERVICE_TOKEN=... ESB_URL=... RABBITMQ_URL=... BOOKING_REST_STOCK_URL=https://host/api/v3/inventory/stock BOOKING_API_KEY=... node apps/services/ms-inventory/dist/main.js
```

Opcional: `BOOKING_SYNC_ENABLED=false`. Sin `BOOKING_REST_STOCK_URL`, el stock queda pendiente en el outbox.
