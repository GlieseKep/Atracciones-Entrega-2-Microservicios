# Plan: actualizar `arquitectura_esb_v3.html` y `microservicios_tablas_v2.html`

Referencia de "lo implementado": lo que despliega `.github/workflows/deploy-azure.yml` (gateway, partner-api, graphql,
esb, sri-mock y los 16 `apps/services/ms-*`) y sus migraciones (ver `MODELO_BASE_DE_DATOS.md`).

## 1. `arquitectura_esb_v3.html`: diferencias encontradas

| # | El diagrama dice | Lo implementado | Cambio |
|---|---|---|---|
| A1 | Booking Prototipo → API Gateway → ESB | El Gateway envía `/api/v3/atracciones/**` a **Partner API** (`apps/partner-api`), que llama al ESB | Agregar el bloque Partner API entre Gateway y ESB |
| A2 | Todo pasa por el ESB | `/api/v3/auth/**` va del Gateway **directo a Identity**; `/graphql` va a GraphQL | Agregar la flecha Gateway → Identity (sesión) |
| A3 | ESB traduce REST ↔ gRPC; Booking, Order, Inventory y Pricing son gRPC nativos | Implementan el servicio del `.proto`, pero se exponen como `POST /internal/rpc/<Método>` (mensaje del proto en JSON sobre HTTP) con `X-Service-Token` | Cambiar la etiqueta (ver pregunta P1) |
| A4 | Inventory → Booking Prototipo por gRPC `PushStockUpdate` :50051 | Inventory envía el stock por **REST `POST /api/v3/inventory/stock`** con `X-API-Key`, directo y sin pasar por el ESB, desde `outbox` (`STOCK_BOOKING`) con reintento cada minuto | Cambiar el bloque "Booking · ingesta gRPC" y la flecha; actualizar la medida 10 |
| A5 | — | Booking avisa el check-in a Booking Central por el ESB (`bookingCore.notifyCheckin`, REST con `X-API-Key`) desde `notificacion_checkin` | Agregar la flecha y la fila en la tabla de comunicaciones |
| A6 | Pasarelas PayPhone · PayPal · Kushki | Solo hay una pasarela simulada (`simulated-gateway.ts`); el webhook se encola en RabbitMQ | Cambiar a "Pasarela de pago (simulada)" |
| A7 | Bus "Kafka / RabbitMQ", topics particionados por clave | RabbitMQ: exchange topic, claves `<servicio>.<Evento>`, cola por consumidor, DLX/DLQ | Dejar solo RabbitMQ y reescribir la medida 5 |
| A8 | Read models: proyecciones en Redis | GraphQL y Partner API guardan lecturas en caché (Redis o memoria) y la vacían con los eventos `catalog.*`, `pricing.*`, `review.*` | Reescribir el bloque y la medida 6 |
| A9 | Identity solo síncrono | Identity publica eventos de bitácora (ROL_ASIGNADO, CLIENTE_API_CREADO, USUARIO_DESACTIVADO…) | Agregarlo en la clasificación |
| A10 | Payment → Invoicing `PagoAprobado` | Invoicing consume `order.OrdenPagada` y `refund.ReembolsoEmitido`; Booking y Order consumen `PagoAprobado`, `PagoRechazado` y `ReembolsoEmitido` | Corregir las filas de eventos |
| A11 | Tabla de comunicaciones incompleta | Faltan las llamadas por ESB que existen: Booking → Refund, Identity, Inventory, Order y Catalog; Cart → Catalog e Inventory; Catalog → Inventory, Location e Identity; Coupon → Location; Pricing → Catalog; Review → Catalog e Identity; Order → Payment; Partner API → Booking, Catalog, Coupon, Inventory e Identity | Completar la tabla |
| A12 | Tablas de las tarjetas | Faltan `notificacion_checkin` (Booking) y las `outbox`; faltan referencias: cliente_api (Billing, Booking), guia (Inventory), reembolso (Booking) | Actualizar las tarjetas (ver P2) |
| A13 | Subtítulo: "tablas de `02_microservicios_v2_bases_de_datos.sql`" | Las tablas salen de las migraciones `ms-*` | Cambiar el subtítulo |

## 2. `microservicios_tablas_v2.html`: diferencias encontradas

| # | El diagrama dice | Lo implementado | Cambio |
|---|---|---|---|
| T1 | Catalog sin `guia` ni `atraccion_itinerario` | Ambas existen (operador 1:N guia, atraccion 1:N atraccion_itinerario) | Agregarlas |
| T2 | Coupon solo con `cupon` | También `acuerdo_promocion` 1:N `acuerdo_promocion_destino` (N:M con ciudad) | Agregarlas |
| T3 | Booking: `reserva`, `estado`, `reserva_pasajero` | También `idempotencia`, `outbox_evento` y `notificacion_checkin` (1:1 con reserva) | Agregarlas |
| T4 | Sin `outbox` | Existe en Identity, Inventory, Pricing, Order, Payment, Refund, Invoicing y Review | Ver P2 |
| T5 | FK compuesta `(hor_id, atr_id)`; `carrito_item (dis_id, atr_id)` | Es `(hor_id, atr_codigo)`; carrito_item usa `atr_codigo` y `dis_slot_codigo` | Corregir el texto |
| T6 | Referencias externas desactualizadas | Billing → cliente_api; Booking → guia, cliente_api, reembolso; Inventory → guia; orden → cliente_api, carrito_item; idempotencia → usuario o cliente_api | Corregir los textos "Ref. externa" |
| T7 | Pie: "46 tablas" | 63 tablas (contando cada `estado`, `idempotencia` y `outbox` por separado) | Recontar según P2 |
| T8 | Subtítulo: división de `Script Base de dats.txt` | Las tablas salen de las migraciones `ms-*` | Cambiar el subtítulo; la nota "Cambios respecto a microservicios_tablas.png" según P3 |

No cambian: los 16 servicios y sus números, los colores por protocolo, el SOAP del SRI por el ESB, el webhook en
cola, el Outbox + idempotencia de Booking ni el flujo del correlation_id.

## 3. Decisiones (respondidas)

P1: (a) gRPC con aclaración · P2: (b) nota común · P3: (b) cambiarla · P4: (b) nota en el bloque SRI.

## 4. Preguntas que se hicieron

- **P1. Cómo mostrar Booking, Order, Inventory y Pricing.** Tienen contrato gRPC (`.proto`), pero el transporte es
  JSON sobre HTTP (`/internal/rpc/<Método>`). Opciones: (a) seguir en verde "gRPC" con la aclaración "contrato .proto
  sobre HTTP", (b) pasarlos a REST.
- **P2. Las tablas `outbox`.** (a) Dibujarlas en cada tarjeta, (b) no dibujarlas y mencionarlas en una nota común.
- **P3. Nota histórica "Cambios respecto a microservicios_tablas.png".** (a) Conservarla, (b) cambiarla por "Cambios
  respecto al diseño v2" con las diferencias T1-T6.
- **P4. Mocks** (`sri-mock` desplegado, `booking-mock` local). (a) No mostrarlos, (b) indicar en el bloque SRI que
  en el despliegue se usa un simulador.
