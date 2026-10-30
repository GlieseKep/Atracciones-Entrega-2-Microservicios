# ms-refund · Refund Service (REST)

Reembolsos (totales o parciales) de pagos aprobados, según el diseño v2 de microservicios. Reemplaza a la tabla `reembolso` y a la ruta `POST /reembolsos` de Payment, con las que convive hasta el corte.

- Contrato: [`Plan/ms_refund/ms_refund-openapi.yaml`](../../../Plan/ms_refund/ms_refund-openapi.yaml)
- Base de datos: `ms_refund` ([`Plan/ms_refund/ms_refund.sql`](../../../Plan/ms_refund/ms_refund.sql); migraciones en `src/persistence/migrations`)
- Plan: [`Plan/ms_refund/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_refund/PLAN_IMPLEMENTACION.md)

## Reglas

- `POST /reembolsos` recibe y responde lo mismo que la ruta de Payment (`clave_pago`, `clave_idempotencia`, `monto`, `motivo`, `solicitante` → `reembolso_codigo`, `monto`, `estado`). La saga de cancelación solo cambia de servicio.
- Idempotente por `clave_idempotencia`: un reintento devuelve el mismo reembolso. Si había quedado `PENDIENTE` (el proceso se cortó), el reintento lo termina.
- Nunca se reembolsa más de lo cobrado: con el pago bloqueado, saldo = monto del pago − comprometido (`EMITIDO` + `PENDIENTE`).
- Pago no aprobado → `SIN_COBRO` (si estaba `PENDIENTE`, se anula en Payment). Sin saldo → `SIN_SALDO`. Ninguno de los dos es un error para la saga.
- Si Payment no responde → `503 PAYMENT_UNAVAILABLE` sin guardar nada.
- Flujo: se registra en `PENDIENTE` (el monto queda comprometido), se pide la devolución a la pasarela y se marca `EMITIDO` (con el evento) o `FALLIDO`. Hoy la pasarela es simulada y aprueba al instante, como hacía Payment.
- Todas las rutas son internas: cuenta de servicio (Order, GraphQL) o el administrador.

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/refund/{operacion}`).

- **Rutas del ESB:** `MS_REFUND_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `RestRoute` de `apps/esb/src/routes.ts`.
- **Cliente:** `RefundClient` (`src/integration/refund-client.ts`) para Order y GraphQL:

  ```ts
  import { RefundClient } from '@atracciones/ms-refund-service';
  const refunds = new RefundClient(new EsbClient(ESB_URL));

  await refunds.refund({ clave_pago, clave_idempotencia, solicitante: 'SAGA_ORCHESTRATOR' }); // saga de cancelación
  await refunds.listByPayments(pagoIds);                                                      // pagos con sus reembolsos
  ```

- **Salida:** `payment.getPaymentByKey` y `payment.voidPayment`, con la cuenta de servicio `refund`.
- **Eventos publicados:** `refund.ReembolsoEmitido` con el mismo payload que publicaba Payment (`reembolso_codigo`, `pago_id`, `orden_id`, `monto`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-refund
INTERNAL_TOKEN_SECRET=... ESB_URL=http://127.0.0.1:3300 node apps/services/ms-refund/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4016` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_refund` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal y firma la cuenta de servicio |
| `ESB_URL` | `http://127.0.0.1:3300` | Payment |
| `RABBITMQ_URL` | (sin valor: bus en memoria) | bus donde se publica `ReembolsoEmitido` |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |

## Migrar los datos actuales

```
node tools/migrate-refunds-to-refund.mjs --dry-run
node tools/migrate-refunds-to-refund.mjs   # copia y compara lo reembolsado por pago en las dos bases
```
