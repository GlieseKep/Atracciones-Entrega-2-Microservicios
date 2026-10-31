# Plan de implementación · ms_order (Order Management Service, gRPC)

| | |
|---|---|
| Microservicio | 10 · Order Management Service |
| Protocolo | gRPC sobre HTTP/2 (detrás del ESB) |
| Clasificación (arquitectura_esb_v3) | Asíncrono: publica `OrdenCreada` y `OrdenPagada`. |
| Contrato | [order.proto](order.proto) |
| Contrato externo de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` (`external_order_id`, `total_price`) |
| Base de datos | [ms_order.sql](ms_order.sql) → base `ms_order` |
| Ref. externas | `usu_id`, `cla_id` (Identity); `cai_id` (Cart); `mpa_id` (Payment); `atr_id` (Catalog); `cup_id` (Coupon) |
| Puerto local propuesto | `GRPC_PORT=50068` |

## 1. Objetivo

Programar el servicio dueño de las órdenes: crea la orden y sus líneas con el precio de Pricing, aplica el cupón, inicia el pago y
sigue su resultado hasta dejarla pagada, cancelada o reembolsada.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 10 de `02_microservicios_v2_bases_de_datos.sql` | `estado`, `orden`, `orden_detalle`, `orden_cupon`, `idempotencia`, `v_orden_financiero` |
| Reglas de compra del mismo script | Una orden = una atracción. Desde el portal nace de un ítem del carrito. Queda `CREADA` hasta que Payment informa. Con pago aprobado pasa a `PAGADA`, marca el ítem `COMPRADO` y publica `OrdenPagada`, y solo entonces se factura. Con pago rechazado pasa a `CANCELADA` y el ítem vuelve a `PENDIENTE` |
| `arquitectura_esb_v3.html` | Booking crea la orden. Order pide la tarifa a Pricing, convierte el carrito con Cart y valida el cupón con Coupon. Invoicing lee sus líneas. Consume `PagoAprobado`, `PagoRechazado` y `ReembolsoEmitido` |
| Contrato v3 | `external_order_id` (`ORD-DILAN-8721`) y `total_price` en USD |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| Tabla `outbox` | La arquitectura exige publicar `OrdenCreada` y `OrdenPagada` |

El resto es la sección 10 sin cambios.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **IVA.** Las tarifas ya incluyen el IVA: son el precio final. `ord_iva = 0`, así `total_price` coincide con el precio que ve el
   cliente, e Invoicing separa el IVA en la factura.
2. **Orden de los pasos.** Los cupos se descuentan antes de cobrar. `CreateOrder` solo crea la orden; Booking llama a
   `StartPayment` después de descontar los cupos.
3. **Un ítem del carrito tras un pago rechazado.** `uq_orden_cai_id` impediría volver a comprar el ítem que regresó a `PENDIENTE`.
   al cancelar, la orden deja `cai_id` en `NULL`.
4. **`PAGADA` es estado final en el script, pero una orden pagada puede reembolsarse.** permitir `PAGADA` → `REEMBOLSADA`;
   `est_final` indica que el pago ya terminó.
5. **Reembolso parcial.** la orden pasa a `REEMBOLSADA` cuando `monto_acumulado` de `ReembolsoEmitido` iguala `ord_total`;
   antes de eso, el estado no cambia.
6. **`mpa_id`.** Order convierte el código del contrato con `GET /metodos-pago` de Payment, en caché, y envía el código a
   `POST /pagos`.
7. **Límite de usos del cupón.** se cuenta en `orden_cupon` dentro de la transacción, con bloqueo por `cup_id`. `Coupon` debe
   devolver `cup_id`; las órdenes `CANCELADA` no cuentan. Cupón inválido → `422`.
8. **Canal.** `usu_id` o `cla_id` salen del principal autenticado. Booking Prototipo no usa carrito ni cupones.
9. **`ord_numero`.** `ORD-DILAN-` más 6 caracteres aleatorios en mayúsculas.
10. **Datos de tarjeta.** pasan de Booking a Payment sin guardarse en Order.

## 4. Estructura del servicio (`apps/services/ms-order`)

```
apps/services/ms-order/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          gRPC, consumidores y publicador del outbox
    app.ts                           configuración y manejadores gRPC
    contract.ts                      tipos del contrato
    application/
      order-service.ts               crear, cancelar y consultar
      payment-flow.ts                StartPayment y POST /pagos
      payment-events.ts              PagoAprobado, PagoRechazado y ReembolsoEmitido
      totals.ts                      subtotal, descuento, IVA y total
      coupons.ts                     validación y límite de usos
      idempotency.ts                 Idempotency-Key por 24 horas
      input.ts                       validación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      order-client.ts                cliente para los demás componentes
    persistence/
      data-source.ts
      order-repository.ts
      idempotency-repository.ts
      migrations/
        index.ts
        <timestamp>-OrderSchema.ts          DDL y estados de ms_order.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 4 programadas en `apps/services/ms-order`; compila y el `.proto` carga. Sin pruebas. Falta la Fase 5, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar `order.proto` a `packages/contracts/proto/`.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL completo de `ms_order.sql`: dominios, trigger de una sola atracción, vista y estados.
- [x] `OrderRepository`: crear orden y líneas, buscar por ID o número, cambiar de estado y listar.
- [x] `IdempotencyRepository`: reservar la clave, guardar la respuesta y limpiar las vencidas.

### Fase 2 · Crear la orden
- [x] **`CreateOrder`:**
  1. Idempotencia por `Idempotency-Key` y sujeto.
  2. Con `cart_item_id`: valida el ítem con Cart.
  3. Pide a Pricing la tarifa vigente en la fecha de la actividad, por tipo de boleto.
  4. Con `coupon_code`: valida con Coupon y calcula `ord_descuento`.
  5. En una transacción: `orden` en `CREADA`, una línea por tipo de boleto con el nombre y precio congelados, `orden_cupon` y `OrdenCreada`.
  6. Con `cart_item_id`: liga el ítem con Cart (`EN_PAGO`). Si Cart lo rechaza, cancela la orden.
- [x] Respuesta con `ord_numero`, la línea de adultos y los totales.

### Fase 3 · Pago y cancelación
- [x] **`StartPayment`:**
  - Total 0: pasa a `PAGADA` sin crear pago.
  - Si no: `POST /pagos` con `numero` = `PAG-<ord_numero>-<intento>` y `canal` según el principal.
- [x] **`CancelOrder`:** cancela el pago pendiente, pasa la orden a `CANCELADA` y devuelve el ítem a `PENDIENTE`. Idempotente. Una orden `PAGADA` no se cancela aquí:
      se reembolsa con Refund.
- [x] Proceso de órdenes colgadas: las `CREADA` de más de 30 minutos se consultan en Payment; si se aprobó, se pagan, y si no, se cancelan.
- [x] `GetOrder`: incluye líneas y dueño. `ListOrders`. `Health`.

### Fase 4 · Eventos
- [x] **`PagoAprobado`:** `PAGADA`, ítem `COMPRADO` en Cart y `OrdenPagada` en la misma transacción. La llamada a Cart se reintenta si falla;
      no revierte el pago.
- [x] **`PagoRechazado`:** `CANCELADA`, y el ítem vuelve a `PENDIENTE`.
- [x] **`ReembolsoEmitido`:** según la decisión 5.
- [x] Todos idempotentes: un evento repetido no cambia una orden que ya pasó de estado.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `order.*`.
- [ ] **Booking:** `CreateOrder`, `StartPayment`, `CancelOrder` y `GetOrder`.
- [ ] **Payment:** su contrato ya incluye `id` en `/metodos-pago`.
- [ ] **Cart, Coupon, Pricing:** sus planes deben incluir lo que Order les pide, con estos identificadores.
- [ ] **Invoicing:** leer las líneas con `GetOrder`, y consumir `OrdenPagada`.
- [ ] **GraphQL:** mis órdenes y administración por el ESB.

## 6. Criterios de aceptación

- Una orden tiene una sola atracción y un ítem del carrito pasa a una sola orden activa.
- `total_price` del contrato coincide con `ord_total`.
- Los precios quedan congelados: un cambio de tarifa no altera una orden existente.
- Solo una orden `PAGADA` se factura.
- Repetir `CreateOrder` con la misma clave no crea otra orden.
- Un cupón no se usa más veces que su `max_uses`, ni con compras simultáneas.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Pago rechazado después de bloquear cupos | Booking reintegra los cupos al recibir `PagoRechazado` |
| Cart no responde tras un pago aprobado | Se reintenta; la compra no se revierte |
| Pricing no responde | La compra no continúa, porque no hay precio confiable |
| Webhook que tarda más que el proceso de vencimiento | El pago ya en estado final no cambia, y la orden se mantiene cancelada |
