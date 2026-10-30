# ms-coupon · Coupon & Promotions Service (REST)

Acuerdo B2B de promociones con Booking Prototipo y cupones del portal, según el diseño v2 de microservicios. Reemplaza al acuerdo que hoy vive en Catalog y a la tabla `cupon` de Order, con los que convive hasta el corte.

- Contrato: [`Plan/ms_coupon/ms_coupon-openapi.yaml`](../../../Plan/ms_coupon/ms_coupon-openapi.yaml)
- Base de datos: `ms_coupon` ([`Plan/ms_coupon/ms_coupon.sql`](../../../Plan/ms_coupon/ms_coupon.sql); migraciones en `src/persistence/migrations`)
- Plan: [`Plan/ms_coupon/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_coupon/PLAN_IMPLEMENTACION.md)

## Reglas

- `GET`/`PUT /atracciones/promociones/contrato` son idénticos al contrato v3: mismos campos y mismos códigos HTTP (los errores del `PUT` son `400`, nunca `422`). Leer exige `promotions:read` (socio o administrador); modificar, `promotions:write` (administrador).
- Los destinos llegan y salen como nombres de ciudad; se guardan como `ciu_id` y se resuelven sin distinguir tildes ni mayúsculas (`banos` = `Baños`).
- Cupones: el código se guarda en mayúsculas; `PORCENTAJE` hasta 100 o `FIJO`. Código, tipo y valor no cambian después de creados.
- `POST /cupones/validacion` no consume el cupón: devuelve si aplica, el descuento y `max_uses`. Los usos los cuenta Order en `orden_cupon`.

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/coupon/{operacion}`).

- **Rutas del ESB:** `MS_COUPON_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `RestRoute` de `apps/esb/src/routes.ts`. El ESB las registra tal cual (y debe aceptar `PATCH`). Una prueba verifica que coinciden con el contrato.
- **Cliente:** `CouponClient` (`src/integration/coupon-client.ts`) para Partner API, GraphQL y Order:

  ```ts
  import { CouponClient } from '@atracciones/ms-coupon-service';
  const coupons = new CouponClient(new EsbClient(ESB_URL));

  await coupons.getPromotionAgreement();                         // Partner API, con la X-API-Key del socio
  await coupons.validateCoupon({ code: 'BIENVENIDA10', subtotal: 75 }); // GraphQL u Order
  ```

- **Salida:** las ciudades se consultan a Catalog (`catalog.getReferences`) con caché de 10 minutos; si Catalog no responde se usa la última lista conocida (`src/application/destinations.ts`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-coupon
INTERNAL_TOKEN_SECRET=... ESB_URL=http://127.0.0.1:3300 node apps/services/ms-coupon/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4011` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_coupon` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal que firma el Gateway |
| `ESB_URL` | `http://127.0.0.1:3300` | catálogo de ciudades (Catalog) |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |
| `COUPON_PROVIDER_ID` | `proveedor-atracciones-dilan` | `proveedor_id` del acuerdo |
| `COUPON_COMMERCIAL_NAME` | `Descubre EC` | `nombre_comercial` si el acuerdo se crea desde cero |

## Pruebas

```
npx jest --selectProjects unit --testPathPattern ms-coupon   # descuento, cuestionario, merge, destinos, rutas vs contrato
npx jest --selectProjects db --testPathPattern ms-coupon     # base, API (validada contra el esquema v3) y CouponClient → ESB simulado
```

## Migrar los datos actuales

```
node tools/migrate-promotions-to-coupon.mjs --dry-run   # cuenta lo que copiaría
node tools/migrate-promotions-to-coupon.mjs
```
