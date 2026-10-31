# ms-pricing · Pricing Service (HTTP interno)

Tarifas versionadas por atracción y tipo de boleto. Las tarifas incluyen IVA.

- Contrato: [`Plan/ms_pricing/pricing.proto`](../../../Plan/ms_pricing/pricing.proto)
- Base de datos: `ms_pricing` ([`Plan/ms_pricing/ms_pricing.sql`](../../../Plan/ms_pricing/ms_pricing.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_pricing/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_pricing/PLAN_IMPLEMENTACION.md)

## Reglas

- La tarifa vale para la fecha de la actividad, no para la de compra.
- La única escritura es `SetPriceTable`, con la tabla completa. `INFANT` siempre vale $0 y la moneda es `USD`.
- Una tabla nueva rige desde `valid_from`, que no puede estar en el pasado, y cierra la anterior el día previo. Con la misma `valid_from` reemplaza los precios.
- Si ya hay una versión posterior, responde `TARIFF_OVERLAP`.
- Un tipo sin tarifa responde `PRICE_NOT_AVAILABLE`, nunca $0.
- Pricing no comprueba que la atracción exista: la tarifa se carga antes de publicarla.

## Permisos

`SetPriceTable` y `ListTariffs` son para `ADMIN`, u `OPERADOR` de la atracción. Para un `OPERADOR`, Pricing consulta `catalog.adminGetAttraction` por el ESB con el principal propagado: Catalog responde `403` si la atracción es de otro operador.

## Eventos

Publica `pricing.TARIFA_ACTUALIZADA` por el outbox, con `attraction_id` y `current_prices`:

- al guardar una tabla que rige hoy;
- el día que empieza una tarifa futura, con un proceso a las 00:05 y al arrancar, que revisa los últimos 7 días.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_PRICING_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `PricingClient` (`src/integration/pricing-client.ts`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-pricing
INTERNAL_TOKEN_SECRET=... SERVICE_TOKEN=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-pricing/dist/main.js
```
