# ms-order · Order Management Service (gRPC)

Crea la orden con el precio de Pricing, aplica el cupón, inicia el pago y sigue su resultado hasta dejarla pagada, cancelada o reembolsada.

- Contrato: [`Plan/ms_order/order.proto`](../../../Plan/ms_order/order.proto), copiado en `packages/contracts/proto/internal/ms-order.proto`
- Base de datos: `ms_order` ([`Plan/ms_order/ms_order.sql`](../../../Plan/ms_order/ms_order.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_order/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_order/PLAN_IMPLEMENTACION.md)

## Reglas

- Una orden tiene una sola atracción. Las tarifas incluyen IVA: `ord_iva = 0`, e Invoicing lo separa.
- Los precios quedan congelados en `orden_detalle`. `det_descripcion` lleva el tipo de boleto, como `Tour Quito (ADULT)`.
- `usu_id` o `cla_id` salen del principal. Booking Prototipo no usa carrito ni cupones.
- `CreateOrder` es idempotente por clave y sujeto, durante 24 horas.
- Una orden de total 0 pasa a `PAGADA` sin crear pago.
- El límite de usos del cupón se cuenta dentro de la transacción. Las órdenes `CANCELADA` no cuentan.
- Al cancelar, la orden deja `cai_id` en `NULL`, para que el ítem se pueda volver a comprar.
- Una orden pagada no se cancela: se reembolsa con Refund.

## Estados

`CREADA` → `PAGADA` → `REEMBOLSADA`, o `CREADA` → `CANCELADA`. Pasa a `REEMBOLSADA` cuando `monto_acumulado` de `ReembolsoEmitido` iguala `ord_total`.

## Procesos

- **`CartSync`:** entrega a Cart las filas `CART_SYNC` del outbox, con reintentos. Se escriben en la transacción del cambio de la orden.
- **`StaleOrders`:** cada 5 minutos revisa las órdenes `CREADA` de más de 30 minutos. Si Payment dice que se aprobó, las paga; si no, las cancela.

## Eventos

- **Publica:** `order.OrdenCreada` y `order.OrdenPagada`.
- **Consume:** `payment.PagoAprobado`, `payment.PagoRechazado` y `refund.ReembolsoEmitido`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_ORDER_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `OrderClient` (`src/integration/order-client.ts`).
- **Llama por el ESB a:** Pricing, Cart, Coupon y Payment.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-order
INTERNAL_TOKEN_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-order/dist/main.js
```
