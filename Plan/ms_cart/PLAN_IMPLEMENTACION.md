# Plan de implementación · ms_cart (Cart Service, REST)

| | |
|---|---|
| Microservicio | 8 · Cart Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Order lo usa por REST. |
| Contrato | [ms_cart-openapi.yaml](ms_cart-openapi.yaml) |
| Base de datos | [ms_cart.sql](ms_cart.sql) → base `ms_cart` |
| Ref. externas | `usu_id` (Identity), `atr_codigo` (Catalog), `dis_slot_codigo` (Inventory), `cai_ord_numero` (Order) |
| Puerto local propuesto | `PORT=4012` |

## 1. Objetivo

Programar el carrito del portal: guarda las atracciones que el usuario quiere comprar y deja pagar cada una por separado.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 8 de `02_microservicios_v2_bases_de_datos.sql` | Remite al script propio `ms_cart.sql`: `carrito`, `carrito_item`, un carrito activo por usuario, y el ciclo `PENDIENTE` → `EN_PAGO` → `COMPRADO` |
| Reglas de Order en el mismo script | La orden nace de un ítem. El pago aprobado lo marca `COMPRADO`; el rechazado lo devuelve a `PENDIENTE` |
| `arquitectura_esb_v3.html` | Referencias a Identity, Catalog e Inventory. Order convierte el carrito en orden por REST |
| Contrato v3 | No tiene rutas de carrito. Los ítems usan los campos de `CreateReservaRequestV3` |

### Cambios a `ms_cart.sql`

| Cambio | Motivo |
|---|---|
| `carrito.usu_id` pasa de `VARCHAR(64)` a `BIGINT` | Regla común de todos los servicios |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Rutas para Order.** `order.proto` solo envía `cart_item_id`. Las rutas internas van por ítem, sin `cart_id`, con
   `X-Service-Token`. Order envía `usu_id` para comprobar que el ítem es del comprador.
2. **Cuándo pasa a `EN_PAGO`.** Al crear la orden, como dice el script. Si Cart lo rechaza, Order cancela esa orden. Al
   cancelar una orden, el ítem vuelve a `PENDIENTE`. El plan de Order ya lo incluye.
3. **Ítems colgados en `EN_PAGO`.** Cart no sabe si el pago se cobró. Decide Order, con un proceso que revisa las órdenes
   `CREADA` de más de 30 minutos: si Payment dice que se aprobó, las paga; si no, las cancela. Cart no libera ítems por su cuenta.
4. **Validar atracción y turno.** Al agregar o editar, Cart pide el ID público a Catalog (`/internal/atracciones/{id}/referencia`)
   y revisa el turno con `GetAvailability` de Inventory, para esa fecha. Un turno inexistente o agotado responde `422`. El carrito no
   reserva cupos: Inventory los vuelve a revisar al comprar.
5. **Agregar lo mismo dos veces.** Si atracción y turno ya están `PENDIENTE`, se reemplazan las cantidades y responde `200`.
6. **Turno opcional.** El script lo permite. Un ítem sin turno se puede guardar, pero no pagar (`422 SLOT_REQUIRED`).
7. **Carritos abandonados.** Un proceso diario pone `car_activo = FALSE` tras 30 días sin cambios y sin ítems `EN_PAGO`.
   Cualquier cambio en un ítem actualiza `car_actualizado_en`.
8. **Tope.** 20 ítems pendientes por carrito (`409 CART_FULL`).
9. **Precio.** Cart no lo guarda, porque el script no tiene esa columna. GraphQL lo pide a Pricing con `QuoteTickets`.
10. **Ítem de otro usuario.** Responde `404`, como en Billing Profile.

## 4. Estructura del servicio (`apps/services/ms-cart`)

```
apps/services/ms-cart/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP y proceso de carritos abandonados
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      cart-input.ts                  validación
      slot.ts                        slot_id a fecha y hora
      item-purchase.ts               PENDIENTE, EN_PAGO y COMPRADO
      abandoned-carts.ts
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      cart-client.ts                 cliente para los demás componentes
      catalog-client.ts
      inventory-client.ts
    persistence/
      data-source.ts
      cart-repository.ts
      migrations/
        index.ts
        <timestamp>-CartSchema.ts    DDL de ms_cart.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 3 programadas en `apps/services/ms-cart`; compila y el contrato pasa Spectral sin errores. Sin pruebas. Falta la Fase 4, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-cart.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL de `ms_cart.sql`.
- [x] `CartRepository`:
  - El carrito se crea con `INSERT ... ON CONFLICT` sobre `ux_carrito_activo`, para que dos pestañas no creen dos.
  - Cada transición de compra bloquea el ítem con `SELECT ... FOR UPDATE`.

### Fase 2 · API REST
- [x] `GET` y `DELETE /carrito`: muestra `PENDIENTE` y `EN_PAGO`; vaciar solo quita los `PENDIENTE`.
- [x] `POST /carrito/items`: `201` si es nuevo, `200` según la decisión 5.
- [x] `PATCH` y `DELETE /carrito/items/{item_id}`: un ítem `EN_PAGO` responde `409 CART_ITEM_IN_PAYMENT`.
- [x] `date` y `time` salen del `slot_id`, sin llamar a Inventory.
- [x] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Compra de un ítem
- [x] `GET /internal/carrito-items/{item_id}`.
- [x] `POST .../orden`: exige `PENDIENTE` y turno; guarda orden, clave y `cai_en_pago_desde`. Es idempotente.
- [x] `POST .../orden/confirmacion`: `EN_PAGO` → `COMPRADO`. Es idempotente.
- [x] `POST .../orden/liberacion`: `EN_PAGO` → `PENDIENTE`, y limpia los datos de la orden. Es idempotente.

### Fase 4 · Integración
- [ ] **ESB:** registrar las rutas `cart.*`.
- [ ] **Order:** leer, ligar, confirmar y liberar el ítem.
- [ ] **GraphQL:** carrito del portal, con el precio de Pricing.

## 6. Criterios de aceptación

- Un usuario tiene como máximo un carrito activo, incluso con peticiones simultáneas.
- Pagar un ítem no cambia los demás.
- Un ítem en pago no se puede editar, quitar ni pagar en otra orden.
- Con el pago rechazado o la orden cancelada, el ítem vuelve a `PENDIENTE`.
- Un ítem comprado sale del carrito, y la atracción se puede volver a agregar.
- No se puede agregar un turno inexistente, agotado o de otra atracción.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Ítem bloqueado en `EN_PAGO` si Order falla | Decisión 3, e índice `ix_carrito_item_en_pago` |
| El turno se agota mientras está en el carrito | Inventory responde al comprar, y el ítem sigue `PENDIENTE` para elegir otro |
| Cart no responde tras un pago aprobado | Order reintenta; la compra no se revierte |
| Validar el turno agrega llamadas | Solo al escribir; las lecturas no consultan a nadie |
