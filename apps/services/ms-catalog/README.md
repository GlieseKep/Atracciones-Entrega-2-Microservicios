# ms-catalog · Catalog & Attractions Service (REST)

Operadores, guías, categorías, idiomas, inclusiones y atracciones. Expone las cinco rutas públicas de catálogo del contrato v3.

- Contrato: [`Plan/ms_catalog/ms_catalog-openapi.yaml`](../../../Plan/ms_catalog/ms_catalog-openapi.yaml)
- Base de datos: `ms_catalog` ([`Plan/ms_catalog/ms_catalog.sql`](../../../Plan/ms_catalog/ms_catalog.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_catalog/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_catalog/PLAN_IMPLEMENTACION.md)

## Reglas

- `id` siempre es `atr_codigo`, nunca `atr_id`. `/atracciones/{id}` acepta código, slug o UUID.
- Solo las atracciones `PUBLICADA` y no eliminadas salen en las rutas públicas.
- Una atracción nace en `BORRADOR`. Publicarla exige categoría, foto y tarifa, que llega de Pricing por evento: la tarifa debe cargarse antes de publicar.
- El filtro por categoría incluye sus subcategorías. Los filtros booleanos solo actúan con `true`.
- `fecha_inicio` y `fecha_fin` se consultan a Inventory antes de paginar.

## Permisos

Vienen en `scopes` del principal interno que firma el Gateway, con los roles de Identity.

- `ADMIN`: todo.
- `OPERADOR`: solo atracciones y guías de los operadores a los que está vinculado.
- `/internal/**`: cabecera `X-Service-Token`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_CATALOG_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `CatalogClient` (`src/integration/catalog-client.ts`).
- **Llama por el ESB a:** `location.getCities`, `location.resolveCities`, `location.getProvince`, `inventory.filterAvailableAttractions` e `identity.getUsers`.
- **Consume:** `review.RESENA_PUBLICADA` y `pricing.TARIFA_ACTUALIZADA`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-catalog
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... ESB_URL=... node apps/services/ms-catalog/dist/main.js
```
