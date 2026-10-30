# ms-payment · Payment Service (REST)

Registra el cobro de una orden, obtiene el resultado de una pasarela **simulada** y avisa por eventos. Es un proyecto académico: no hay conexión con pasarelas reales.

- Contrato: [`Plan/ms_payment/ms_payment-openapi.yaml`](../../../Plan/ms_payment/ms_payment-openapi.yaml)
- Base de datos: `ms_payment` ([`Plan/ms_payment/ms_payment.sql`](../../../Plan/ms_payment/ms_payment.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_payment/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_payment/PLAN_IMPLEMENTACION.md)

## Reglas

- `POST /pagos` lo llama Order y es idempotente por `numero`.
- **Canal `B2B`:** el pago queda `APROBADO` de inmediato, sin pasarela.
- **Canal `WEB`:** queda `PENDIENTE` y la pasarela responde por webhook. Tarjeta sin datos responde `422`.
- **Simulación:** aprueba siempre, salvo con `ultimos4 = 0000`. `PAYPAL` siempre se aprueba.
- **Transferencias:** el cliente envía el comprobante y un `ADMIN` lo aprueba o rechaza.
- **Cancelar:** un pago `PENDIENTE` pasa a `FALLIDO`. Uno `APROBADO` se devuelve con Refund.
- Una orden tiene a lo sumo un pago aprobado. Un pago en estado final no cambia.
- Nunca se guarda el número de la tarjeta ni el CVV: solo se leen los campos del contrato.

## Webhook

`POST /webhooks/simulada` valida `X-Signature` (HMAC-SHA256 del JSON canónico con `WEBHOOK_SECRET`), encola y responde `202`. Si el bus no acepta, responde `503` y la pasarela reintenta.

## Eventos

Publica `payment.PagoAprobado` y `payment.PagoRechazado` por el outbox, con `pag_id`, `numero`, `ord_id`, `metodo` y `monto`, más `referencia` y `autorizacion`, o `motivo`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_PAYMENT_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `PaymentClient` (`src/integration/payment-client.ts`).
- **Llama por el ESB a:** `order.getOrder`, para comprobar el dueño de una transferencia.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-payment
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... WEBHOOK_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-payment/dist/main.js
```
