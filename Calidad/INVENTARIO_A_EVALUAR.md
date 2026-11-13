# Inventario a evaluar · Lint, pruebas unitarias, de integración, E2E y contratos Pact

Lista de los procesos, microservicios, endpoints y mensajes que entran en cada categoría. Es solo el inventario: no define todavía cómo se va a probar cada cosa.

**Criterio de alcance:** solo entra lo que **define el contrato OpenAPI v3** (`Plan/PlanBooking/atracciones-openapi-v3(1).yaml`) **y se implementó de la misma forma**, junto con los componentes que ejecutan esos procesos. Lo que el contrato no define, o que se implementó de otra forma, está en la sección 0.3 y no aparece en las demás.

## 0. Alcance

### 0.1 Procesos del contrato v3 implementados igual

| # | Proceso del contrato | Operación v3 | Implementación |
|---|---|---|---|
| P1 | Taxonomía de categorías (árbol con `incluye_comida`, `incluye_transporte`, `incluye_guia`) | `GET /atracciones/categorias/arbol` | Partner API → ms-catalog |
| P2 | Listado plano de categorías | `GET /atracciones/categorias` | Partner API → ms-catalog |
| P3 | Búsqueda avanzada | `POST /atracciones/search` | Partner API → ms-catalog (→ ms-location, ms-inventory) |
| P4 | Listado de atracciones | `GET /atracciones` | Partner API → ms-catalog |
| P5 | Ficha técnica (itinerario, valoraciones, punto de encuentro, tarifas por edad) | `GET /atracciones/{id}` | Partner API → ms-catalog (precios de ms-pricing y valoraciones de ms-review por eventos) |
| P6 | Disponibilidad de turnos (`DISPONIBLE` / `ULTIMOS_CUPOS` / `AGOTADO`) | `GET /atracciones/{id}/disponibilidad` | Partner API → ms-inventory |
| P7 | Compra con saga y compensación (`201`, `400 SLOT_TIME_MISMATCH`, `422`, `409 OUT_OF_STOCK`) | `POST /atracciones/reservas` | Partner API → ms-booking → ms-identity, ms-catalog, ms-order (→ ms-pricing, ms-payment), ms-inventory |
| P8 | Consulta de reserva | `GET /atracciones/reservas/{id}` | Partner API → ms-booking (→ ms-inventory, ms-catalog) |
| P9 | Cancelación / compensación (`SAGA_ORCHESTRATOR`) | `POST /atracciones/reservas/{id}/cancel` | Partner API → ms-booking → ms-order, ms-inventory, ms-refund |
| P10 | Check-in presencial | `POST /atracciones/reservas/{id}/checkin` | Partner API → ms-booking |
| P11 | Acuerdo de promociones B2B | `GET` y `PUT /atracciones/promociones/contrato` | Partner API → ms-coupon |
| P12 | Feed Outbox EDA (`RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `STOCK_ACTUALIZADO`, `RESERVA_CANCELADA`) | `GET /atracciones/eventos` | Partner API → ms-booking |
| P13 | Salud del nodo (foco verde / rojo) | `GET /atracciones/health` | Partner API → `health` de los nodos críticos (catalog, pricing, inventory, order, booking, payment) y opcionales (refund, invoicing, audit). ms-invoicing y ms-audit solo entran por este chequeo |
| T1 | Transversal: autenticación `BearerAuth` (JWT) y `ApiKeyAuth` (`X-API-Key`) | Todas | Gateway → ms-identity |
| T2 | Transversal: `X-Correlation-Id`, `Idempotency-Key` y errores RFC 7807 | Todas | Gateway, Partner API, ESB, `packages/platform` |

### 0.2 Componentes que entran

| Componente | Rol en el contrato | Procesos |
|---|---|---|
| `apps/gateway` | Entrada `/api/v3`, autenticación, correlación y principal interno | T1, T2 |
| `apps/partner-api` | Implementa las 14 operaciones del contrato | P1–P13 |
| `apps/esb` | Enruta de la Partner API y entre servicios | Todos |
| `packages/platform` | Errores, idempotencia, outbox, bus, cliente del ESB, principal, formatos | T2 y todos |
| `packages/contracts` | `.proto` internos y OpenAPI de los servicios | Todos |
| ms-catalog | Categorías, búsqueda, listado y ficha | P1–P5, P7, P8 |
| ms-inventory | Turnos, aforo, reserva y liberación de cupos | P3, P6–P9 |
| ms-booking | Reservas, saga, cancelación, check-in y eventos | P7–P10, P12 |
| ms-coupon | Acuerdo de promociones | P11 |
| ms-identity | Validación de JWT y `X-API-Key`, alta del turista (`ensureClient`) | T1, P7 |
| ms-order | Orden de la reserva y su pago | P7, P9 |
| ms-pricing | Cotización por edad (`quoteTickets`) y tarifas de la ficha | P5, P7 |
| ms-payment | Cobro de la orden | P7, P9 |
| ms-refund | Reembolso de la cancelación | P9 |
| ms-location | Ciudades y provincias de la búsqueda y la ficha | P3–P5 |
| ms-billing-profile | Perfil principal del turista que crea `ensureClient` | P7 |
| ms-review | Origen de las valoraciones de la ficha (evento `RESENA_PUBLICADA`) | P5 |

### 0.3 Fuera del alcance

**No están definidos en el contrato v3:**
- Portal web y panel de administración (`AtraccionesService-web`) y GraphQL (`apps/graphql`).
- Las sesiones de usuario de `/api/v3/auth/*` (registro, login, recuperación…).
- ms-cart, ms-support, ms-audit y ms-invoicing, con el SRI y `apps/sri-mock`.
- Las operaciones de administración de ms-catalog, ms-inventory, ms-coupon, ms-identity, ms-review y ms-pricing (catálogo, horarios, cupones, usuarios, socios, moderación…).
- El aviso del check-in a Booking Central (`bookingCore.notifyCheckin`, `checkin-notifier`) y `apps/booking-mock` como simulador de Booking Central.
- El handler `apps/partner-api/src/handlers/clients.ts` (`findClient`, `createClient`), que no tiene ruta registrada.
- Los servicios heredados: `apps/api`, `apps/auth`, `packages/{domain, business, data-access, data-management}` y `apps/services/{identity, catalog, inventory, cart, order, booking, payment, invoicing, audit}`.

**Definidos en el contrato pero implementados de otra forma:**
- **Envío de stock a Booking.** El contrato (secciones 1.1.4 y 2.2) exige gRPC `inventory.InventoryStockService` (`PushStockUpdate`, `StreamInventoryChanges`) al puerto 50051. ms-inventory lo envía por REST (`POST /api/v3/inventory/stock`, `booking-stock-client`, `booking-stock-sync`). El `.proto` existe en `packages/contracts/proto/booking/inventory.proto`, pero no se usa como transporte.
- **Rutas `/api/v2` y `/api/v1`.** El contrato las declara en `servers`, pero el Gateway solo atiende `/api/v3`.

---

## 1. Lint

### 1.1 Código TypeScript

| Componente | Lint que existe hoy |
|---|---|
| `apps/gateway`, `apps/partner-api`, `apps/esb` | Solo `tsc` (`npm run lint` en la raíz es `tsc -b --noEmit`) |
| ms-catalog, ms-inventory, ms-booking, ms-coupon, ms-identity, ms-order, ms-pricing, ms-payment, ms-refund, ms-location, ms-billing-profile, ms-review | Solo `tsc` |
| `packages/platform`, `packages/contracts` | Solo `tsc` |

### 1.2 Contratos y artefactos de interfaz

| Artefacto | Ruta | Lint que existe hoy |
|---|---|---|
| Contrato OpenAPI v3 | `packages/contracts/openapi/atracciones-openapi-v3.yaml` (copia en `Plan/PlanBooking/atracciones-openapi-v3(1).yaml`) | Ninguno. `npm run contract:lint` apunta al v2 |
| OpenAPI internos de los servicios del alcance | `packages/contracts/openapi/ms-{catalog, coupon, identity, location, payment, refund, review, billing-profile}.yaml` | Ninguno |
| Protobuf internos | `packages/contracts/proto/internal/{ms-booking, ms-inventory, ms-order, pricing}.proto` | Ninguno |
| Migraciones SQL de los servicios del alcance | `apps/services/ms-*/src/persistence/migrations` | Ninguno |

---

## 2. Pruebas unitarias

Lógica que se puede aislar de la red y de la base de datos. Solo los módulos que intervienen en los procesos de la sección 0.1.

### 2.1 Código compartido (`packages/platform`)

| Módulo | Qué contiene | Procesos |
|---|---|---|
| `problem-details.ts` | `AppError`, `toProblem` (RFC 7807 con `code`, `correlation_id`, `timestamp`) | T2 |
| `formats.ts` | Fechas, horas, zona `America/Guayaquil` (`zonedToUtc`), formatos del contrato | P6–P10 |
| `documents.ts` | Validación de cédula, RUC y pasaporte (`customer`) | P7 |
| `principal.ts` | Firma y verificación del principal interno | T1 |
| `correlation.ts` | `X-Correlation-Id` | T2 |
| `paging.ts` | Paginación de listados | P4, P12 |
| `contract.ts`, `contract-files.ts` | Valores del contrato (estados, tipos de evento, `slot_id`) | Todos |
| `esb-client.ts`, `rpc-http.ts`, `grpc.ts`, `http.ts` | Clientes y adaptadores de transporte | Todos |
| `persistence/idempotency.ts`, `persistence/outbox.ts` | `Idempotency-Key` y outbox | T2, P7, P9, P12 |
| `health.ts` | Salud del nodo | P13 |

Hoy ya tienen pruebas `contract-files.test.ts` y `formats.test.ts`.

### 2.2 Bordes

| Componente | Módulos | Procesos |
|---|---|---|
| `apps/gateway` | `authentication.ts` (JWT o `X-API-Key`), `isContractPath`, sin 429 en el contrato, borrado del principal externo, `config.ts` | T1, T2 |
| `apps/partner-api` | `routes.ts` (orden de rutas fijas antes de `/:id`), `handlers/catalog.ts`, `handlers/reservations.ts` (incluido `solicitante` por defecto `SAGA_ORCHESTRATOR`), `handlers/events.ts`, `health.ts`, `request.ts`, `errors.ts`, `contract.ts` | P1–P13 |
| `apps/esb` | `routes.ts` (`servicio.operación` → destino) y la traducción de parámetros a ruta, query y cuerpo | Todos |

### 2.3 Microservicios (`src/application/*`)

| Servicio | Módulos | Procesos |
|---|---|---|
| ms-catalog | `search`, `attraction-service`, `attraction-mapper`, `attraction-input`, `availability`, `locations`, `fields`, `event-handlers` (precio y valoración) | P1–P5 |
| ms-inventory | `availability` (`DISPONIBLE` / `ULTIMOS_CUPOS` / `AGOTADO`), `slot-generator`, `input` | P6, P7, P9 |
| ms-booking | `purchase-flow` (saga y compensación LIFO), `cancellation-flow` (estados, plazo de 24 h, `SAGA_ORCHESTRATOR`, reembolso, stock), `checkin-service`, `lifecycle` (`EXPIRED` / `COMPLETED`), `event-publisher`, `payment-events`, `reservation-mapper` (respuesta del contrato y `_links`), `reservation-service`, `voucher` (QR), `idempotency`, `input` (incluido `SLOT_TIME_MISMATCH`), `remote` | P7–P10, P12 |
| ms-coupon | `agreement` | P11 |
| ms-identity | `credential-validator`, `tokens` (JWT), `api-client-service` (`X-API-Key`), `client-service` (`ensureClient`), `input` | T1, P7 |
| ms-order | `order-service` (orden del socio, sin carrito ni cupón), `payment-flow`, `payment-methods`, `payment-events`, `totals`, `stale-orders`, `idempotency`, `input` | P7, P9 |
| ms-pricing | `quote` (adulto, niño, senior, infante), `price-table`, `events/effective-tariffs-job` | P5, P7 |
| ms-payment | `payment-service`, `webhook-processor`, `input` | P7 |
| ms-refund | `refund-service`, `refund-input` | P9 |
| ms-location | `geography`, `input` | P3–P5 |
| ms-billing-profile | `profile-input` (perfil principal) | P7 |
| ms-review | `review-service` (publicación de la valoración) | P5 |

---

## 3. Pruebas de integración

Un componente con sus dependencias reales (PostgreSQL, RabbitMQ, el ESB u otro servicio), sin recorrer el proceso de punta a punta.

### 3.1 Persistencia (PostgreSQL)

| Servicio | Base | Repositorios y puntos críticos | Procesos |
|---|---|---|---|
| ms-catalog | `ms_catalog` | `attraction-repository`, `category-repository` (árbol recursivo), `guide-repository`, `inclusion-repository`, `sql-errors` | P1–P5 |
| ms-inventory | `ms_inventory` | `seat-repository` (reserva y liberación con actualización condicional, sin sobreventa), `availability-repository`, `schedule-repository` | P6, P7, P9 |
| ms-booking | `ms_booking` | `reservation-repository` (estados y transiciones), `event-repository` (feed Outbox), `idempotency-repository` | P7–P10, P12 |
| ms-coupon | `ms_coupon` | `agreement-repository` | P11 |
| ms-identity | `ms_identity` | `api-client-repository` (hash de la llave), `user-repository` (turista de `ensureClient`), `token-repository` | T1, P7 |
| ms-order | `ms_order` | `order-repository` (estados y outbox `OrdenPagada`), `idempotency-repository` | P7, P9 |
| ms-pricing | `ms_pricing` | `pricing-repository` (tarifas vigentes, outbox `TARIFA_ACTUALIZADA`) | P5, P7 |
| ms-payment | `ms_payment` | `payment-repository` (outbox `PagoAprobado` / `PagoRechazado`) | P7 |
| ms-refund | `ms_refund` | `refund-repository` (outbox `ReembolsoEmitido`) | P9 |
| ms-location | `ms_location` | `location-repository` | P3–P5 |
| ms-billing-profile | `ms_billing_profile` | `profile-repository` (un perfil principal por cliente) | P7 |
| ms-review | `ms_review` | `review-repository` (outbox `RESENA_PUBLICADA`) | P5 |
| Todos los anteriores | — | Migraciones y restricciones | — |

### 3.2 Infraestructura compartida (`packages/platform`)

| Módulo | Dependencia real | Procesos |
|---|---|---|
| `persistence/idempotency.ts` | PostgreSQL: misma `Idempotency-Key` → misma respuesta; clave en curso → `IDEMPOTENCY_IN_PROGRESS` | T2, P7, P9, P10 |
| `persistence/outbox.ts`, `persistence/outbox-relay.ts` | PostgreSQL y RabbitMQ: el evento se guarda en la misma transacción y se publica una vez | P7, P9, P12 |
| `messaging.ts` | RabbitMQ: exchange, routing keys y colas | P5, P7, P9 |
| `esb-client.ts`, `rpc-http.ts` | ESB y servicios reales: timeouts, ProblemDetails, correlación | Todos |
| `principal.ts` | Gateway → servicio: el principal firmado | T1 |
| `health.ts` | `Health` de cada nodo | P13 |

### 3.3 Transporte: Gateway, Partner API, ESB y servicios

| Integración | Qué se integra | Procesos |
|---|---|---|
| Gateway ↔ ms-identity | `validateToken` (JWT) y `validateApiKey` (`X-API-Key`), con caché | T1 |
| Gateway ↔ Partner API | Proxy de `/api/v3`, `X-Correlation-Id`, principal interno, 503 cuando un componente no responde | T1, T2 |
| Partner API ↔ ESB ↔ servicios | Cada handler (`catalog`, `reservations`, `events`, `health`) con respuestas reales | P1–P13 |
| ESB ↔ servicios REST | Rutas de ms-catalog, ms-coupon, ms-identity, ms-location, ms-payment, ms-refund y ms-billing-profile | Todos |
| ESB ↔ servicios RPC | `POST /internal/rpc/<Método>` de ms-booking, ms-order, ms-inventory y ms-pricing con los mensajes del `.proto` | P6–P10, P12 |

### 3.4 Colaboración entre microservicios (vía ESB)

| Proceso parcial | Servicios | Procesos |
|---|---|---|
| Saga de compra: turista, referencia, orden, cupos y pago, con compensación (`ReleaseSeats`, `CancelOrder`) | ms-booking + ms-identity (+ ms-billing-profile) + ms-catalog + ms-order + ms-inventory | P7 |
| Orden del socio: cotización y cobro | ms-order + ms-pricing + ms-payment | P7 |
| Cancelación: orden, cupos y reembolso | ms-booking + ms-order + ms-inventory + ms-refund (+ ms-payment) | P9 |
| Consulta de reserva con turno y logística | ms-booking + ms-inventory + ms-catalog | P8 |
| Búsqueda con ciudades y disponibilidad | ms-catalog + ms-location + ms-inventory | P3 |
| Salud agregada del nodo | Partner API + `Health` de los servicios | P13 |

### 3.5 Eventos: productor → RabbitMQ → consumidor

| Integración | Servicios | Procesos |
|---|---|---|
| Pago aprobado o rechazado | ms-payment → ms-order y ms-booking | P7 |
| Reembolso emitido | ms-refund → ms-order y ms-booking | P9 |
| Tarifa actualizada | ms-pricing → ms-catalog | P5 |
| Reseña publicada (valoraciones) | ms-review → ms-catalog | P5 |
| Eventos de reserva al feed | ms-booking (`event-repository`, `event-publisher`) → bus y `listEvents` | P12 |
| Reentrega del mismo evento | Cada consumidor anterior | — |

### 3.6 Procesos programados con su base

| Proceso | Servicio | Procesos |
|---|---|---|
| `lifecycle` (`EXPIRED`, `COMPLETED`, cupos devueltos, `STOCK_ACTUALIZADO`) | ms-booking + ms-inventory | P8, P12 |
| `stale-orders` (órdenes colgadas, claves vencidas) | ms-order + ms-payment | P7 |
| `slot-generator` (turnos hacia adelante) | ms-inventory | P6 |
| `effective-tariffs-job` (tarifas vigentes) | ms-pricing | P5 |

---

## 4. Pruebas E2E

Procesos completos a través del Gateway (`/api/v3`) como los ejecuta Booking, con `X-API-Key` o JWT.

| Proceso | Recorrido | Casos del contrato |
|---|---|---|
| P1 Árbol de categorías | Gateway → Partner API → ESB → ms-catalog | Banderas `incluye_*` |
| P2 Categorías | Igual que P1 | — |
| P3 Búsqueda avanzada | → ms-catalog → ms-location, ms-inventory | Filtros, paginación |
| P4 Listado de atracciones | → ms-catalog | Paginación, HATEOAS |
| P5 Ficha técnica | → ms-catalog (datos de ms-pricing y ms-review) | `404` de atracción inexistente |
| P6 Disponibilidad | → ms-inventory | `DISPONIBLE`, `ULTIMOS_CUPOS`, `AGOTADO` |
| P7 Compra | → ms-booking → ms-identity, ms-catalog, ms-order, ms-pricing, ms-payment, ms-inventory | `201` con `external_order_id`, PNR y QR; `400 SLOT_TIME_MISMATCH`; `422`; `409 OUT_OF_STOCK` con compensación; repetición con la misma `Idempotency-Key` |
| P8 Consulta de reserva | → ms-booking | `404` |
| P9 Cancelación | → ms-booking → ms-order, ms-inventory, ms-refund | `SAGA_ORCHESTRATOR`, plazo de 24 h, ya cancelada, cupos devueltos |
| P10 Check-in | → ms-booking | Titular válido, reserva ya usada o cancelada |
| P11 Acuerdo de promociones | → ms-coupon | `GET` y `PUT` |
| P12 Feed Outbox | P7 / P9 → ms-booking → `GET /atracciones/eventos` | Los 4 tipos de evento |
| P13 Salud | → Partner API → nodos | `200` UP, `503` DOWN |
| T1 Autenticación | Gateway → ms-identity | Sin credencial (`401`), JWT válido, `X-API-Key` válida o inactiva |
| T2 Cabeceras y errores | Todas | `X-Correlation-Id` de ida y vuelta, `application/problem+json` |

Hoy `test/system/fase1-gateway`, `fase2-catalogo`, `fase3-compra`, `fase4-cancelacion-checkin` y `fase5-eventos` cubren parte de esta tabla.

---

## 5. Verificación de contratos Pact

### 5.1 Contrato externo v3

| Consumidor | Proveedor | Interacciones | Referencia |
|---|---|---|---|
| Booking Prototipo | Partner API, vía Gateway | Las 14 operaciones de la sección 0.1 (P1–P13), con `BearerAuth` / `ApiKeyAuth`, `X-Correlation-Id`, `Idempotency-Key` y respuestas `application/problem+json` | `atracciones-openapi-v3.yaml` |

### 5.2 Contratos internos: Gateway y Partner API → servicios (vía ESB)

| Consumidor | Proveedor | Operaciones del ESB | Procesos |
|---|---|---|---|
| Gateway | ms-identity | `validateToken`, `validateApiKey` | T1 |
| Partner API | ms-catalog | `getCategoryTree`, `listCategories`, `searchAttractions`, `listAttractions`, `getAttraction` | P1–P5 |
| Partner API | ms-inventory | `getAvailability`, `listScheduleTimes` | P6 |
| Partner API | ms-booking | `createReservation`, `getReservation`, `cancelReservation`, `checkIn`, `listEvents` | P7–P10, P12 |
| Partner API | ms-coupon | `getAgreement`, `updateAgreement` | P11 |
| Partner API | Nodos críticos (catalog, pricing, inventory, order, booking, payment) y opcionales (refund, invoicing, audit) | `health` | P13 |

### 5.3 Contratos internos entre microservicios (vía ESB)

| Consumidor | Proveedor | Operaciones | Procesos |
|---|---|---|---|
| ms-booking | ms-identity | `ensureClient` | P7 |
| ms-booking | ms-catalog | `getReference`, `getLogistics` | P7, P8 |
| ms-booking | ms-order | `createOrder`, `startPayment`, `cancelOrder`, `getOrder` | P7, P9 |
| ms-booking | ms-inventory | `reserveSeats`, `releaseSeats`, `getSlotsByIds` | P7–P9 |
| ms-booking | ms-refund | `createRefund` | P9 |
| ms-order | ms-pricing | `quoteTickets` | P7 |
| ms-order | ms-payment | `listMethods`, `createPayment`, `cancelPayment`, `listOrderPayments` | P7, P9 |
| ms-refund | ms-payment | `listOrderPayments` | P9 |
| ms-payment | ms-order | `getOrder` | P7 |
| ms-identity | ms-billing-profile | `ensurePrincipalForClient` | P7 |
| ms-catalog | ms-location | `getCities`, `getProvince`, `resolveCities` | P3–P5 |
| ms-catalog | ms-inventory | `filterAvailableAttractions` | P3 |

### 5.4 Contratos de mensajes (RabbitMQ)

| Productor | Evento | Consumidores | Procesos |
|---|---|---|---|
| ms-booking | `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `STOCK_ACTUALIZADO`, `RESERVA_CANCELADA` (esquema `OutboxEventItem` del contrato) | Feed `GET /atracciones/eventos` (Booking) | P12 |
| ms-payment | `payment.PagoAprobado`, `payment.PagoRechazado` | ms-order, ms-booking | P7 |
| ms-refund | `refund.ReembolsoEmitido` | ms-order, ms-booking | P9 |
| ms-pricing | `pricing.TARIFA_ACTUALIZADA` | ms-catalog | P5 |
| ms-review | `review.RESENA_PUBLICADA` | ms-catalog | P5 |

---

## Lo que ya existe (del alcance)

| Categoría | Hoy |
|---|---|
| Lint | `tsc --noEmit`. Spectral solo sobre el OpenAPI v2, no el v3 |
| Unitarias | Jest (proyecto `unit`): `packages/platform` (`contract-files.test.ts`, `formats.test.ts`) |
| Integración | Jest (proyecto `db`): `apps/services/test/*.db.test.ts`. Prueban las bases heredadas (`identity_db`, `booking_db`…), no las `ms_*` del alcance |
| E2E | Jest (proyecto `e2e`): `test/system/fase1…fase5` con PostgreSQL embebido |
| Pact | Nada instalado ni configurado |
