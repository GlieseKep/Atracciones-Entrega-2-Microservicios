# ms-invoicing · Electronic Invoicing Service

Emite la factura cuando una orden queda pagada, guarda una copia de los datos del comprador, la autoriza con el SRI simulado desde una cola y avisa cuando queda autorizada.

- Contrato: [`Plan/ms_invoicing/ms_invoicing-openapi.yaml`](../../../Plan/ms_invoicing/ms_invoicing-openapi.yaml)
- Base de datos: `ms_invoicing` ([`Plan/ms_invoicing/ms_invoicing.sql`](../../../Plan/ms_invoicing/ms_invoicing.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_invoicing/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_invoicing/PLAN_IMPLEMENTACION.md)

## Reglas

- Se factura únicamente con `OrdenPagada`, y a lo sumo una vez por orden.
- **Comprador:** el perfil principal de Billing Profile. Sin perfil, o en una orden B2B, `CONSUMIDOR_FINAL`.
- **IVA:** las tarifas lo incluyen. La base es el precio entre 1,15, y `fde_iva` sale por diferencia: `fac_total` es exactamente `ord_total`.
- **Descuento:** se reparte en proporción al valor de cada línea, y la diferencia de centavos va a la última.
- **Numeración:** `001-001-` más 9 dígitos. La clave de acceso tiene 49 dígitos, con módulo 11.
- La factura nace `PAGADA` y `PENDIENTE` ante el SRI. La firma del XML es simulada, y el XML no se guarda.
- Cuando `monto_acumulado` iguala el total, pasa a `ANULADA`. Sin notas de crédito.

## Cola del SRI

Un worker envía una factura a la vez, según `SRI_MAX_POR_MINUTO`, por `sri.validarComprobante` y `sri.autorizacionComprobante`. Un error técnico se reintenta a los 1, 2, 4 y 8 minutos. Al quinto fallo, o con un rechazo del SRI, queda `RECHAZADA` para que un `ADMIN` la revise. La compra nunca espera por esto.

## Eventos

- **Consume:** `order.OrdenPagada` y `refund.ReembolsoEmitido`.
- **Publica:** `invoicing.FacturaAutorizada`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_INVOICING_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `InvoicingClient` (`src/integration/invoicing-client.ts`).
- **Llama por el ESB a:** `order.getOrder`, `billing.getPrincipal` y `sri.*`.
- **SRI simulado:** `apps/sri-mock`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-invoicing
SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-invoicing/dist/main.js
```

Opcionales: `SRI_RUC`, `SRI_RAZON_SOCIAL`, `SRI_DIRECCION`, `IVA_PORCENTAJE`, `FACTURA_CORREO_DEFECTO` y `SRI_MAX_POR_MINUTO`.
