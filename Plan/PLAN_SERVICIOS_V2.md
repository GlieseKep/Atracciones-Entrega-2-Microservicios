# Plan general · Microservicios del diseño v2

## 1. Fuentes

Los planes se derivan solo de estas fuentes, sin tomar en cuenta lo ya programado:

| Fuente | Uso |
|---|---|
| `02_microservicios_v2_bases_de_datos.sql` | Tablas de cada microservicio |
| `arquitectura_esb_v3.html` | Separación por módulos, comunicación y eventos |
| `PlanBooking/atracciones-openapi-v3(1).yaml` | Contrato obligatorio con Booking Prototipo |
| `PlanBooking/inventory.proto` | Stock por gRPC hacia Booking Prototipo |

El contrato manda sobre el script general. Una tabla solo cambia si el contrato o la arquitectura lo exigen, y cada `.sql` indica por qué.

## 2. Estado de los planes

| # | Servicio | Base | Protocolo | Puerto | Plan |
|---|---|---|---|---|---|
| 1 | Identity | `ms_identity` | REST | `4018` | Rehecho y confirmado: [plan](ms_identity/PLAN_IMPLEMENTACION.md) |
| 4 | Catalog | `ms_catalog` | REST | `4019` | Rehecho y confirmado: [plan](ms_catalog/PLAN_IMPLEMENTACION.md) |
| 7 | Inventory | `ms_inventory` | gRPC | `50067` | Rehecho y confirmado: [plan](ms_inventory/PLAN_IMPLEMENTACION.md) |
| 12 | Payment | `ms_payment` | REST | `4020` | Rehecho y confirmado: [plan](ms_payment/PLAN_IMPLEMENTACION.md) |
| 11 | Booking | `ms_booking` | gRPC | `50069` | Rehecho y confirmado: [plan](ms_booking/PLAN_IMPLEMENTACION.md) |
| 10 | Order | `ms_order` | gRPC | `50068` | Rehecho y confirmado: [plan](ms_order/PLAN_IMPLEMENTACION.md) |
| 14 | Invoicing | `ms_invoicing` | SOAP con el SRI | `4021` | Rehecho y confirmado: [plan](ms_invoicing/PLAN_IMPLEMENTACION.md) |
| 16 | Audit | `ms_audit` | Eventos y REST | `4022` | Rehecho y confirmado: [plan](ms_audit/PLAN_IMPLEMENTACION.md) |
| 2 | Billing Profile | `ms_billing_profile` | REST | `4013` | Rehecho y confirmado: [plan](ms_billing_profile/PLAN_IMPLEMENTACION.md) |
| 3 | Location | `ms_location` | REST | `4014` | Rehecho y confirmado: [plan](ms_location/PLAN_IMPLEMENTACION.md) |
| 5 | Review | `ms_review` | REST | `4015` | Rehecho y confirmado: [plan](ms_review/PLAN_IMPLEMENTACION.md) |
| 6 | Pricing | `ms_pricing` | gRPC | `50062` | Rehecho y confirmado: [plan](ms_pricing/PLAN_IMPLEMENTACION.md) |
| 8 | Cart | `ms_cart` | REST | `4012` | Rehecho y confirmado: [plan](ms_cart/PLAN_IMPLEMENTACION.md) |
| 9 | Coupon | `ms_coupon` | REST | `4011` | Rehecho y confirmado: [plan](ms_coupon/PLAN_IMPLEMENTACION.md) |
| 13 | Refund | `ms_refund` | REST | `4016` | Rehecho y confirmado: [plan](ms_refund/PLAN_IMPLEMENTACION.md) |
| 15 | Support | `ms_support` | REST | `4017` | Rehecho y confirmado: [plan](ms_support/PLAN_IMPLEMENTACION.md) |

## 3. Reglas comunes

- Prefijo REST `/api/v3`, salud con `NodeHealthResponse` y errores RFC 7807 con `ProblemDetails`, copiados del contrato v3.
- `X-Correlation-Id` se propaga en todas las llamadas y eventos.
- Solo hay FOREIGN KEY dentro de un mismo servicio. Entre servicios, ID lógico.
- `usu_id` y `cla_id` son `BIGINT`. El contrato solo fija UUID en `reservation_id`, `event_id`, `Idempotency-Key` y `uuid` de la atracción.
- Las rutas internas usan la cabecera `X-Service-Token`.
- Todo servicio que publica eventos los escribe en su outbox, en la misma transacción. Booking usa `outbox_evento`.
- Las tarifas incluyen IVA.
- La pasarela de pagos y el SRI son simulados.

## 4. Lo que los planes confirmados piden a los demás

| Servicio | Debe ofrecer |
|---|---|
| Location | Ciudades en lote y conversión de nombre a `ciu_id`, para Catalog |
| Pricing | `TARIFA_ACTUALIZADA` con la tabla vigente completa; tarifa por tipo de boleto para Order |
| Review | `RESENA_PUBLICADA` con los promedios ya calculados, sin tabla propia en Catalog |
| Cart | Validar un ítem y marcarlo `COMPRADO` o `PENDIENTE`, para Order |
| Coupon | Validar un cupón y devolver `cup_id`, para Order |
| Refund | Reembolso síncrono para Booking, por `ord_id`; `ReembolsoEmitido` con `ord_id`, `monto` y `monto_acumulado` |
| Billing Profile | Perfil principal de un usuario, para Invoicing |

## 5. Validación

Todos los `.sql` de `Plan/ms_*` se ejecutaron en un PostgreSQL temporal sin errores, y los contratos YAML y `.proto` rehechos se cargaron
sin errores. No se lintaron con Spectral.
