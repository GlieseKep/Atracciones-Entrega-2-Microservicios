# ms-billing-profile · Billing Profile Service (REST)

Datos de facturación de cada usuario. Un usuario puede tener varios perfiles y uno principal, que Invoicing usa como comprador.

- Contrato: [`Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`](../../../Plan/ms_billing_profile/ms_billing_profile-openapi.yaml)
- Base de datos: `ms_billing_profile` ([`Plan/ms_billing_profile/ms_billing_profile.sql`](../../../Plan/ms_billing_profile/ms_billing_profile.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md)

## Reglas

- El primer perfil de un usuario queda como principal. Al desactivar el principal, el activo más reciente pasa a serlo.
- Crear un perfil con el documento de uno desactivado lo reactiva con los datos nuevos.
- La cédula se valida con módulo 10; el pasaporte se guarda en mayúsculas.
- `CONSUMIDOR_FINAL` se completa con `9999999999999` si no se envía el número.
- El perfil de otro usuario responde `404`.
- Las escrituras de un usuario van de una en una, con `pg_advisory_xact_lock`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_BILLING_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `BillingProfileClient` (`src/integration/billing-profile-client.ts`), para Invoicing y GraphQL.
- No publica ni consume eventos.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-billing-profile
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... node apps/services/ms-billing-profile/dist/main.js
```
