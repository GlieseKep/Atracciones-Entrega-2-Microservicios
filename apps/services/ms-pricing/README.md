# ms-pricing · Pricing Service (gRPC)

Tarifas versionadas por atracción y tipo de boleto, según el diseño v2 de microservicios. Reemplaza a las tarifas que hoy viven en Inventory, con las que convive hasta el corte.

- Contrato: [`Plan/ms_pricing/pricing.proto`](../../../Plan/ms_pricing/pricing.proto) (copia que carga el servicio: `packages/contracts/proto/internal/pricing.proto`)
- Base de datos: `ms_pricing` ([`Plan/ms_pricing/ms_pricing.sql`](../../../Plan/ms_pricing/ms_pricing.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_pricing/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_pricing/PLAN_IMPLEMENTACION.md)

## Reglas

- Tipos de boleto del contrato v3: `ADULT`, `CHILD`, `SENIOR`, `INFANT` (precio 0 pero ocupa cupo) y `STUDENT`. La atracción se identifica con su ID público de 12 caracteres.
- Una versión nueva cierra la vigente el día anterior; si ya hay una que empieza ese mismo día, la reemplaza. Dos versiones de la misma tarifa no pueden cruzarse (`TARIFF_OVERLAP`). Una vigencia no puede empezar en el pasado.
- `SetPriceTable` guarda la tabla completa en una transacción y exige `ADULT > 0`, `CHILD`, `SENIOR` e `INFANT` (`TARIFF_INCOMPLETE`); sin `student`, deja de haber tarifa de estudiante desde esa fecha.
- Un tipo sin tarifa vigente no se envía (no es 0). `from_price` = ADULT o, sin ella, la menor tarifa mayor que 0.
- `QuoteTickets` congela el precio: Order guarda `unit_price` y `tariff_id` de cada línea. Falta una tarifa pedida → `PRICE_NOT_AVAILABLE`.
- Consultas abiertas; administración (`ListTariffs`, `SetPriceTable`, `SetTariff`, `CloseTariff`) con el scope de administrador.
- Cada cambio escribe `TARIFA_ACTUALIZADA` en el outbox (misma transacción) con la tabla vigente hoy; el relay lo publica en el bus.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_PRICING_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `GrpcRoute` de `apps/esb/src/routes.ts`; el ESB las registra tal cual (target `pricing`).
- **Cliente:** `PricingClient` (`src/integration/pricing-client.ts`) para Order (`quoteTickets`), Catalog y Partner API (`getPriceTables`, `getPriceTable`), Inventory (`getPriceTable`) y GraphQL (administración).
- **Evento:** `TARIFA_ACTUALIZADA` (payload `TariffUpdatedPayload`), para Catalog (precio "desde") y los read models.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-pricing
INTERNAL_TOKEN_SECRET=... RABBITMQ_URL=amqp://localhost node apps/services/ms-pricing/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `GRPC_PORT` | `50062` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_pricing` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal de la administración |
| `RABBITMQ_URL` | (vacío = bus en memoria) | publicación de `TARIFA_ACTUALIZADA` |
| `APP_TIMEZONE` | `America/Guayaquil` | "hoy" para vigencias |

## Migrar las tarifas de Inventory

```
node tools/migrate-tariffs-to-pricing.mjs --dry-run   # cuenta lo que copiaría
node tools/migrate-tariffs-to-pricing.mjs             # copia y compara la tabla vigente hoy en las dos bases
```
