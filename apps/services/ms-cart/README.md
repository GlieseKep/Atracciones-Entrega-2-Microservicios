# ms-cart · Cart Service (REST)

Carrito del portal según el diseño v2 de microservicios. Reemplaza a `apps/services/cart`, con el que convive hasta el corte.

- Contrato: [`Plan/ms_cart/ms_cart-openapi.yaml`](../../../Plan/ms_cart/ms_cart-openapi.yaml)
- Base de datos: `ms_cart` ([`Plan/ms_cart/ms_cart.sql`](../../../Plan/ms_cart/ms_cart.sql); migración `src/persistence/migrations`)
- Plan: [`Plan/ms_cart/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_cart/PLAN_IMPLEMENTACION.md)

## Reglas

- Cada ítem usa los campos de `CreateReservaRequestV3` (`attraction_id`, `slot_id`, `adult_count`…). La atracción se guarda por su ID público de 12 caracteres.
- **Cada atracción se paga por separado.** Order paga un ítem a la vez:
  `PENDIENTE` → `EN_PAGO` (`POST /carritos/{c}/items/{i}/orden`) → `COMPRADO` (`.../orden/confirmacion`, solo con el pago aprobado), o de vuelta a `PENDIENTE` (`.../orden/liberacion`) si el pago se rechaza.
- Sin favoritos.

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/cart/{operacion}`).

- **Rutas del ESB:** `MS_CART_ROUTES` (`src/integration/esb-routes.ts`) tiene la tabla `cart.*` → método y ruta, con la forma de `RestRoute` de `apps/esb/src/routes.ts`. El ESB la registra tal cual (y debe aceptar `PATCH`). Una prueba verifica que coincide con el contrato.
- **Cliente:** `CartClient` (`src/integration/cart-client.ts`) para GraphQL y Order:

  ```ts
  import { CartClient } from '@atracciones/ms-cart-service';
  const cart = new CartClient(new EsbClient(ESB_URL));

  // GraphQL, dentro de la petición del usuario
  await cart.addItem({ attraction_id: 'PRhu4UBTWPBC', slot_id: 'slot-20261125-1030', adult_count: 2 });

  // Order, con su cuenta de servicio
  await asService('order', INTERNAL_TOKEN_SECRET, () => cart.startItemPayment(cartId, itemId, 'ORD-…', idempotencyKey));
  ```

  Los errores llegan como `AppError` con el estado y el código del servicio (p. ej. 409 `CART_ITEM_IN_PAYMENT`).
- **Salida:** Cart consulta a Catalog (`catalog.getAttraction`) e Inventory (`inventory.getAvailability`) al agregar o cambiar un turno (`src/application/lookups.ts`).
- **Tipos del contrato:** `src/contract.ts` (`CartDto`, `CartItemDto`, `CartItemRequestDto`…).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-cart
INTERNAL_TOKEN_SECRET=... ESB_URL=http://127.0.0.1:3300 node apps/services/ms-cart/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4012` | 4004 queda para el Cart actual hasta el corte |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_cart` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal que firma el Gateway |
| `ESB_URL` | `http://127.0.0.1:3300` | valida atracciones (Catalog) y turnos (Inventory) |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |
| `CART_MAX_ITEMS` | `10` | ítems pendientes o en pago por carrito |
| `CART_TTL_DAYS` | `30` | días sin cambios para dar un carrito por abandonado |
| `CART_INTERNAL_CALLERS` | `order` | servicios que pueden usar las rutas `/carritos/**` |

## Pruebas

```
npx jest --selectProjects unit --testPathPattern ms-cart     # turno, validación, transiciones de compra
npx jest --selectProjects db --testPathPattern ms-cart       # base, API completa y CartClient → ESB simulado → servicio
```

## Migrar los carritos del Cart actual

```
node tools/migrate-cart-to-ms-cart.mjs --dry-run   # cuenta lo que copiaría
node tools/migrate-cart-to-ms-cart.mjs
```
