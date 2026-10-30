# ms-cart · Cart Service (REST)

Carrito del portal. Guarda las atracciones que el usuario quiere comprar y deja pagar cada una por separado. Booking Prototipo no lo usa.

- Contrato: [`Plan/ms_cart/ms_cart-openapi.yaml`](../../../Plan/ms_cart/ms_cart-openapi.yaml)
- Base de datos: `ms_cart` ([`Plan/ms_cart/ms_cart.sql`](../../../Plan/ms_cart/ms_cart.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_cart/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_cart/PLAN_IMPLEMENTACION.md)

## Reglas

- Un usuario tiene un carrito activo. Pagar un ítem no cambia los demás.
- `PENDIENTE` → (Order crea la orden) → `EN_PAGO` → (pago aprobado) → `COMPRADO`. Con el pago rechazado o la orden cancelada, vuelve a `PENDIENTE`.
- Un ítem `EN_PAGO` no se edita ni se quita. Un ítem `COMPRADO` sale del carrito, y la atracción se puede volver a agregar.
- Agregar la misma atracción y turno reemplaza las cantidades y responde `200`.
- Un ítem sin turno se puede guardar, pero no pagar (`422 SLOT_REQUIRED`).
- Tope de 20 ítems pendientes (`409 CART_FULL`).
- El ítem de otro usuario responde `404`.
- Un carrito sin cambios en 30 días y sin ítems `EN_PAGO` se desactiva.
- Cart no guarda precios ni reserva cupos. No libera ítems por su cuenta: eso lo decide Order.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_CART_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `CartClient` (`src/integration/cart-client.ts`).
- **Llama por el ESB a:** `catalog.getReference` e `inventory.getAvailability`, solo al escribir.
- `/internal/**` exige `X-Service-Token`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-cart
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... ESB_URL=... node apps/services/ms-cart/dist/main.js
```
