# Plan: actualizar el README con la arquitectura y los patrones de diseño

Pedido: "actualiza el readme con los patrones de diseño y demás arquitectura de la aplicación".

Solo cambia `README.md`. No se toca código, configuración ni infraestructura.

## Problema actual

El `README.md` describe la generación anterior del sistema: monolito `apps/api` (`/api/v1`), `apps/auth`, URLs del
App Service `tourgirls-api-mms` y `start-local.cmd`. Lo que hoy se compila y despliega (`deploy-azure.yml`,
`tools/launcher.mjs`) es la cadena de microservicios del contrato v3: Gateway → Partner API / GraphQL → ESB → 16
servicios `ms-*`, todo en una sola App Service (`tourgirls-gateway-mm`).

## Contenido propuesto del nuevo README

1. **Qué es TourGirls**: descripción corta (sin cambios de fondo).
2. **Vista general de la arquitectura**
   - Diagrama ASCII: Portal web / Booking Prototipo → Gateway (:3000) → { Identity (auth), Partner API (:3100),
     GraphQL (:3200) } → ESB (:3300) → microservicios `ms-*`; RabbitMQ (eventos), Redis (caché), PostgreSQL (una base
     por servicio); sistemas externos: SRI (SOAP, `sri-mock`), Booking Central (`booking-mock`).
   - Referencia a `Plan/arquitectura_esb_v3.png` y `Plan/microservicios_tablas.png`.
3. **Componentes**: tabla con carpeta, puerto, protocolo y responsabilidad de: gateway, partner-api, graphql, esb,
   sri-mock, booking-mock y los 16 `ms-*` (identity, location, catalog, billing-profile, pricing, inventory, review,
   coupon, cart, payment, order, booking, refund, invoicing, support, audit) con su protocolo (REST / gRPC sobre
   `/internal/rpc` / SOAP) y su base.
4. **Estructura de carpetas** (`apps/`, `apps/services/ms-*/src/{application,integration,persistence}`,
   `packages/platform`, `infra/`, `tools/`, `Plan/`, `Calidad/`, `AtraccionesService-web/`).
5. **Patrones de diseño y de integración**, cada uno con *dónde está* (archivo) y *para qué*:
   - API Gateway (`apps/gateway`): autenticación centralizada JWT / X-API-Key, principal interno firmado,
     `X-Correlation-Id`, límite de tasa, CORS.
   - Enterprise Service Bus (`apps/esb`): tabla de rutas `servicio.operación`, traducción de protocolos REST/gRPC/SOAP,
     plazos por ruta.
   - Circuit Breaker (`opossum` en `apps/esb/src/app.ts`).
   - Backend for Frontend con GraphQL (`apps/graphql`): caché de lecturas públicas, límites de profundidad y complejidad.
   - Database per Service (una base `ms_*` por servicio, migraciones propias).
   - Transactional Outbox + publicación asíncrona (`outbox_evento`, `EventPublisher` de ms-booking, outbox de
     ms-identity).
   - Publish/Subscribe con RabbitMQ (exchange topic, una cola por consumidor) y Dead Letter Queue
     (`packages/platform/src/messaging.ts`); `InMemoryEventBus` para desarrollo y pruebas.
   - Saga con compensación (cancelación `SAGA_ORCHESTRATOR`, eventos de pago en ms-order / ms-booking).
   - Idempotency Key (cabecera `Idempotency-Key`, `idempotency-repository` por servicio).
   - Correlation ID / contexto de petición (`AsyncLocalStorage` en `packages/platform/src/correlation.ts`).
   - Repository y capas application / integration / persistence en cada servicio.
   - Adapter / Strategy para la pasarela de pago (`PaymentGateway` + `SimulatedGateway`).
   - Cache-aside (`MemoryCache` / `RedisCache`).
   - Reintentos con backoff en la sincronización de stock con Booking (`booking-stock-sync.ts`).
   - Problem Details RFC 7807 como formato único de error.
   - Contract-first: OpenAPI v3 como fuente de verdad, `.proto` por servicio gRPC.
6. **Flujos principales** (texto breve, 3–5 pasos cada uno): compra del portal (carrito → orden → pago → reserva →
   factura SRI) y reserva / cancelación desde Booking (Partner API).
7. **Seguridad**: credenciales externas solo en el Gateway; `X-Service-Token` entre ESB y servicios; principal interno
   firmado con `INTERNAL_TOKEN_SECRET`; roles y scopes de socio.
8. **Desarrollo local**: `docker compose -f infra/docker-compose.yml up -d`, `npm run build`, `npm run db:migrate`,
   `start-microservices.ps1` / `tools/launcher.mjs`, con tabla de puertos.
9. **Scripts** (`build`, `test:*`, `db:*`, `contract:*`).
10. **Calidad y CI**: workflows `pruebas.yml` y `deploy-azure.yml`; enlace a `Calidad/`.
11. **Despliegue**: una App Service, URLs vigentes, enlace a `Plan/DESPLIEGUE_AZURE_MICROSERVICIOS.md`.

## Preguntas abiertas

1. **Código de generaciones anteriores** (`apps/api`, `apps/auth`, `packages/domain|business|data-*|contracts` y los
   servicios sin prefijo `apps/services/{identity,catalog,inventory,cart,order,booking,payment,invoicing,audit}`):
   ¿se omiten del README, se mencionan en una sección corta "Legado" o se documentan igual que el resto?
   (`start-microservices.ps1` todavía arranca varios de ellos.)
2. **URLs de despliegue**: ¿cuáles son las vigentes del Gateway y del frontend? Las del README actual apuntan al
   App Service `tourgirls-api-mms`, que ya no es el destino del workflow.
3. **Diagramas**: ¿solo diagrama ASCII en el README, o además enlazar/incrustar las imágenes PNG de `Plan/`?
4. **Nivel de detalle de los patrones**: ¿tabla compacta (patrón | dónde | para qué) o una subsección por patrón con
   una explicación de un párrafo (útil para la defensa)?
5. **Contrato**: la memoria del proyecto dice que la fuente de verdad es `Plan/PlanBooking/atracciones-openapi-v3(1).yaml`,
   pero los scripts `contract:*` de `package.json` apuntan al v2. ¿El README menciona solo el v3?
