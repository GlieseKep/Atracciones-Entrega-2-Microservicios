# ms-billing-profile · Billing Profile Service (REST)

Datos de facturación (comprador de la factura electrónica del SRI) de los usuarios del portal, según el diseño v2 de microservicios. Reemplaza a la tabla `dato_facturacion` de Identity, con la que convive hasta el corte.

- Contrato: [`Plan/ms_billing_profile/ms_billing_profile-openapi.yaml`](../../../Plan/ms_billing_profile/ms_billing_profile-openapi.yaml)
- Base de datos: `ms_billing_profile` ([`Plan/ms_billing_profile/ms_billing_profile.sql`](../../../Plan/ms_billing_profile/ms_billing_profile.sql); migraciones en `src/persistence/migrations`)
- Plan: [`Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_billing_profile/PLAN_IMPLEMENTACION.md)

## Reglas

- Un usuario puede tener varios perfiles activos y siempre exactamente uno principal. El primero queda como principal; al desactivar el principal, el activo más reciente pasa a serlo. Las operaciones de un usuario se serializan con un bloqueo por usuario.
- Documento según su tipo: `CEDULA` (10 dígitos con dígito verificador), `RUC` (13), `PASAPORTE` (6 a 20 letras o dígitos, en mayúsculas), `CONSUMIDOR_FINAL` (`9999999999999`; si no se envía, se completa).
- `DELETE` es un borrado lógico. Si se vuelve a crear un perfil con el mismo tipo y número, se reactiva.
- `/usuarios/me/**` solo para principales de tipo `USUARIO`; el perfil de otro usuario responde `404`. `GET /datos-facturacion/{id}` es para las cuentas de servicio (Order, Invoicing) o el administrador, y responde también perfiles inactivos.
- `GET`/`PUT /usuarios/me/facturacion` tienen la misma forma que en Identity (`tipo_documento`, `numero_documento`, `email`) y operan sobre el principal.

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/billing/{operacion}`).

- **Rutas del ESB:** `MS_BILLING_PROFILE_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `RestRoute` de `apps/esb/src/routes.ts`.
- **Cliente:** `BillingProfileClient` (`src/integration/billing-profile-client.ts`):

  ```ts
  import { BillingProfileClient } from '@atracciones/ms-billing-profile-service';
  const billing = new BillingProfileClient(new EsbClient(ESB_URL));

  await billing.getLegacy();        // GraphQL myBilling (reemplaza identity.getBilling)
  await billing.getProfile(42);     // Invoicing, con su cuenta de servicio
  ```

- No publica ni consume eventos.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-billing-profile
INTERNAL_TOKEN_SECRET=... node apps/services/ms-billing-profile/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4013` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_billing_profile` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal que firma el Gateway |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |

## Migrar los datos actuales

```
node tools/migrate-billing-to-profile.mjs --dry-run   # informa lo que copiaría y las filas que no cumplen las reglas nuevas
node tools/migrate-billing-to-profile.mjs
```
