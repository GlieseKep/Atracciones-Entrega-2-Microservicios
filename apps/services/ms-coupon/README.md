# ms-coupon · Coupon & Promotions Service (REST)

Cupones del portal y acuerdo de promociones con Booking Prototipo.

- Contrato: [`Plan/ms_coupon/ms_coupon-openapi.yaml`](../../../Plan/ms_coupon/ms_coupon-openapi.yaml)
- Base de datos: `ms_coupon` ([`Plan/ms_coupon/ms_coupon.sql`](../../../Plan/ms_coupon/ms_coupon.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_coupon/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_coupon/PLAN_IMPLEMENTACION.md)

## Reglas

- **Acuerdo:** `GET` y `PUT /atracciones/promociones/contrato` aceptan `X-API-Key` de Booking Prototipo o el rol `ADMIN`. Lo que no se envía conserva su valor, `fecha_acuerdo` pasa a hoy y, sin promociones, el porcentaje queda en `0`. Un acuerdo vencido se responde igual.
- **Destinos:** se guardan como `ciu_id`. Un nombre desconocido responde `400`. Una provincia, como Galápagos, se guarda como sus ciudades, y la respuesta las devuelve por nombre.
- **Cupones:** son solo para `ADMIN`. Solo cambian vigencia, límite de usos y estado. No se borran.
- **Validación:** no consume el cupón. La vigencia se compara con la fecha de compra. Un cupón que no aplica responde `200` con `valid = false`. Las tarifas incluyen IVA: el descuento se calcula sobre el precio final.
- **Usos:** se cuentan en `orden_cupon` (Order), que recibe `cup_id` y `max_uses`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_COUPON_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `CouponClient` (`src/integration/coupon-client.ts`).
- **Llama por el ESB a:** `location.getCities` y `location.resolveCities`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-coupon
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... ESB_URL=... node apps/services/ms-coupon/dist/main.js
```
