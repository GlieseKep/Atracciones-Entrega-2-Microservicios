# ms-location · Location Service (REST)

Catálogo de solo lectura de regiones, provincias y ciudades de Ecuador.

- Contrato: [`Plan/ms_location/ms_location-openapi.yaml`](../../../Plan/ms_location/ms_location-openapi.yaml)
- Base de datos: `ms_location` ([`Plan/ms_location/ms_location.sql`](../../../Plan/ms_location/ms_location.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_location/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_location/PLAN_IMPLEMENTACION.md)

## Reglas

- Las filas se cargan en memoria al arrancar. Agregar o desactivar una ciudad se hace con una migración, y queda disponible al reiniciar.
- Los nombres se comparan sin tildes ni mayúsculas: `banos`, `BAÑOS` y `Baños` son la misma ciudad.
- En la resolución, un nombre es primero una ciudad y, si no lo es, una provincia, que devuelve todas sus ciudades (`Galápagos`).
- Las listas solo muestran lo activo. Las rutas por ID también responden inactivos, para datos históricos.
- Las consultas `GET` son públicas. `/internal/**` exige `X-Service-Token`.
- No tiene rutas de escritura ni eventos.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_LOCATION_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `LocationClient` (`src/integration/location-client.ts`), para Catalog, Coupon y GraphQL.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-location
SERVICE_TOKEN=... node apps/services/ms-location/dist/main.js
```

`SERVICE_TOKEN` debe tener al menos 32 caracteres.
