# ms-refund · Refund Service (REST)

Devuelve lo cobrado por una orden, sin superar el monto pagado, y publica `ReembolsoEmitido`.

- Contrato: [`Plan/ms_refund/ms_refund-openapi.yaml`](../../../Plan/ms_refund/ms_refund-openapi.yaml)
- Base de datos: `ms_refund` ([`Plan/ms_refund/ms_refund.sql`](../../../Plan/ms_refund/ms_refund.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_refund/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_refund/PLAN_IMPLEMENTACION.md)

## Reglas

- `POST /reembolsos` recibe `ord_id`. Refund busca el pago aprobado en Payment y guarda `pag_id`.
- La pasarela es simulada: el reembolso se procesa en la misma petición, sin estados intermedios.
- Sin `monto` se devuelve todo el saldo. Superarlo responde `409 REFUND_EXCEEDS_BALANCE`.
- Sin pago aprobado responde `409 NO_APPROVED_PAYMENT`. Si Payment no responde, `503 PAYMENT_UNAVAILABLE`, sin crear nada.
- `Idempotency-Key` es obligatoria. Booking usa `res_uuid`. La misma clave con otros datos responde `409 IDEMPOTENCY_KEY_REUSED`.
- Cada reembolso toma un bloqueo por `pag_id` mientras suma el saldo.
- Las rutas son para Booking, con `X-Service-Token`, o para `ADMIN`.

## Eventos

Publica `refund.ReembolsoEmitido` por el outbox, con `reembolso_id`, `pag_id`, `ord_id`, `monto` y `monto_acumulado`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_REFUND_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `RefundClient` (`src/integration/refund-client.ts`).
- **Llama por el ESB a:** `payment.listOrderPayments`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-refund
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-refund/dist/main.js
```
