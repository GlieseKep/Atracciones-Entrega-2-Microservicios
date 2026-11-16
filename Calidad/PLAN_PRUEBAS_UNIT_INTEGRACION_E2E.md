# Plan de pruebas · Unitarias, de integración y E2E

Plan para probar lo listado en las secciones 2, 3 y 4 de [`INVENTARIO_A_EVALUAR.md`](INVENTARIO_A_EVALUAR.md). Lint y Pact (secciones 1 y 5) no entran en este plan.

**Alcance:** el mismo del inventario. Solo los procesos P1–P13 y T1–T2 del contrato OpenAPI v3 (`Plan/PlanBooking/atracciones-openapi-v3(1).yaml`) que se implementaron igual, y solo los componentes de la sección 0.2. Lo de la sección 0.3 (portal web, GraphQL, `/auth/*`, ms-cart, ms-support, ms-audit, ms-invoicing, SRI, `booking-mock`, envío de stock por REST, servicios heredados) no se prueba.

**Contrato usado por las pruebas:** `packages/contracts/openapi/atracciones-openapi-v3.yaml` (v3.0.0), copia de `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` con un único cambio aceptado: la respuesta 200 de `GET /atracciones` (P4) es un arreglo de `AtraccionListadoSimple` en lugar de `SearchAtraccionesResponseV2`. Las pruebas de P4 validan esa forma; el resto del contrato es idéntico al del plan.

**Regla principal: no se modifica el código del proyecto.** Las pruebas solo agregan archivos nuevos (`*.test.ts`, `*.int.test.ts`, `*.e2e.test.ts`, fixtures, harness) y configuración de pruebas (proyecto `integration` en `jest.config.js`, script `test:integration` en `package.json` y `.github/workflows/pruebas.yml`). No se toca nada de `apps/*/src`, `apps/services/ms-*/src`, `packages/*/src` (salvo archivos `*.test.ts` nuevos), `infra/`, `tools/`, `start-microservices.ps1`, los workflows existentes ni la configuración de Azure. En consecuencia:

- Lo que no está exportado (por ejemplo `isContractPath` en `apps/gateway/src/app.ts`) se prueba a través de lo que sí se exporta (la app del Gateway con `supertest`), nunca agregando un `export`.
- El tiempo (plazo de 24 h, vencimientos, vigencias) se controla con `jest.useFakeTimers()` y `jest.setSystemTime()`, porque el código usa `Date.now()` directamente. No se inyecta un reloj.
- Si una prueba encuentra un error en el código, no se corrige: se reporta y se decide aparte.
- El código ya existe, así que las pruebas se escriben después (no es TDD). Una prueba que queda en rojo por un error real se deja documentada; no se cambia su aserción para que pase.

**Base del plan:** *Semana 9 · Pruebas de integración y contract testing* (pirámide 9.1, test doubles 9.4, CI/CD 9.5). Pact (9.2–9.3) va en un plan aparte.

---

## 1. Pirámide

| Nivel | Cantidad | % | Qué aísla | Tiempo esperado de la suite |
|---|---:|---:|---|---|
| Unitarias | **367** | 70 % | Una función o módulo, sin red ni base (dobles para todo lo externo) | < 30 s |
| Integración | **135** | 26 % | Un componente con sus dependencias reales (PostgreSQL, bus, ESB, otro servicio) | 3–6 min |
| E2E | **19** | 4 % | Los flujos críticos completos por el Gateway `/api/v3`, como los ejecuta Booking | 3–5 min |
| **Total** | **521** | | | |

```
                    ▲
                   ╱ ╲            E2E · 19
                  ╱   ╲           Gateway → Partner API → ESB → ms-* → PostgreSQL
                 ╱─────╲
                ╱       ╲         Integración · 135
               ╱         ╲        Repositorios, outbox, bus, ESB, colaboración entre servicios
              ╱───────────╲
             ╱             ╲      Unitarias · 367
            ╱               ╲     platform, gateway, partner-api, esb, application/* de cada ms
           ╱─────────────────╲
```

**Regla de la pirámide:** cada caso se escribe en el nivel más bajo que lo puede detectar. Un E2E solo existe si comprueba algo que ninguna unitaria ni integración puede ver (el recorrido completo, las cabeceras de ida y vuelta, el contrato visto por Booking). Las variantes de validación, cálculo o estado se prueban en unitarias o integración, no en E2E.

**Cambio respecto a la versión anterior:** el E2E bajó de 40 a 19 casos. El PDF pide "pocas E2E, solo los flujos más críticos" (9.1 y caso integrador) y advierte que los E2E acumulados para variantes deberían ser pruebas de integración, más rápidas (ejercicio 9.5b). Los 21 casos quitados no se pierden: cada uno queda cubierto en un nivel más bajo (tabla 5.1).

Las cantidades son el objetivo de diseño de cada sección; se pueden ajustar al escribir las pruebas, siempre que se mantenga **unitarias > integración > E2E**.

---

## 2. Herramientas y convenciones

| Tema | Unitarias | Integración | E2E |
|---|---|---|---|
| Runner | Jest + ts-jest (proyecto `unit` existente) | Jest, proyecto nuevo `integration` (`*.int.test.ts`); el proyecto `db` existente no se toca | Jest (proyecto `e2e` existente) |
| Ubicación | Junto al módulo: `src/**/<módulo>.test.ts` | `apps/services/ms-*/test/*.int.test.ts`, `apps/{gateway,partner-api,esb}/test/*.int.test.ts`, `packages/platform/test/*.int.test.ts` | `test/system/v3/*.e2e.test.ts` |
| Dependencias | Dobles (stubs/fakes) para repositorios, ESB y bus, pasados por los parámetros que el código ya recibe | `embedded-postgres` (ya en `tools/test/global-setup.js`), una base `ms_*` por servicio con sus migraciones; RabbitMQ local; HTTP con `supertest` | Sistema completo levantado en proceso sobre los `ms-*` del alcance, con RabbitMQ local |
| Reloj | `jest.useFakeTimers()` y `jest.setSystemTime()` (plazo de 24 h, vigencias, `EXPIRED`) | Fechas fijas en los datos semilla | Turnos generados relativos a "ahora" |
| Comando | `npm run test:unit` | `npm run test:integration` (nuevo) | `npm run test:e2e` |

**RabbitMQ local (integración y E2E):**
- En local se usa el servicio `rabbitmq` que ya existe en `infra/docker-compose.yml` (`docker compose -f infra/docker-compose.yml up -d rabbitmq`, con Docker Desktop abierto). En CI, un contenedor de servicio del job.
- El harness crea el bus con `createEventBus('amqp://guest:guest@localhost:5672')`: la URL va fija en el código de prueba y **no se lee `RABBITMQ_URL` del entorno**, así que las pruebas no pueden conectarse al RabbitMQ real.
- Exchange y prefijo propios de las pruebas (`RABBITMQ_EXCHANGE=pruebas.events`, `RABBITMQ_PREFIX=pruebas`), fijados en el `setupFiles` del proyecto Jest antes de cargar `messaging.ts`, para no mezclarse con lo que use `start-microservices.ps1` en el mismo Docker.
- Al terminar cada suite se borran las colas y el exchange de prueba.
- La conexión real (variables de la App Service en Azure) no se toca ni se borra.

### 2.1 Test doubles (PDF 9.4)

Cada doble se elige por lo que la prueba necesita verificar, con la taxonomía de Meszaros:

| Doble | Se usa para | Ejemplos en este plan |
|---|---|---|
| **Dummy** | Parámetros que el caso no usa | Logger o contexto que la función recibe pero el caso no revisa |
| **Stub** | Que una dependencia devuelva un valor fijo | Respuesta del ESB en los handlers de Partner API; ms-identity en `authentication.ts`; tarifa en `quote` |
| **Spy** | Verificar que se llamó, cuántas veces, con qué argumentos y en qué orden | Compensación LIFO de `purchase-flow` (`ReleaseSeats` antes de `CancelOrder`, una vez cada una); `event-publisher` publica una sola vez el tipo correcto; la caché del Gateway evita la segunda llamada a ms-identity |
| **Mock estricto** | Que la prueba falle si una llamada esperada no ocurre | No se usa como tipo aparte: se cubre con spy + `toHaveBeenCalledTimes(n)` / `not.toHaveBeenCalled()` |
| **Fake** | Una versión simple pero funcional | Repositorios en memoria para `idempotency`, `outbox` y los repositorios de cada `application/*` |

Reglas:
- **Nunca se dobla la unidad bajo prueba**, solo sus dependencias.
- Los dobles se tipan con la interfaz real (`jest.Mocked<…>` o `satisfies` del tipo del puerto), para que `tsc` falle si la firma real cambia y el doble no quede desactualizado.
- Cada archivo de prueba restaura los dobles con `afterEach(() => jest.restoreAllMocks())`, para que los contadores de un caso no pasen al siguiente.
- **Sobre-mockeo compensado:** donde la unitaria dobla todo lo externo, hay una integración con las piezas reales que cubre el mismo camino: handlers de Partner API (3.2) ↔ 4.3; `purchase-flow` y `cancellation-flow` (3.3) ↔ 4.4; `payment-events` y `event-handlers` (3.3) ↔ 4.5.
- **Dobles HTTP en integración:** los servicios que no participan se reemplazan por un servidor HTTP falso levantado en proceso con `node:http` en un puerto libre (`listen(0)`), con respuestas fijas (stub) y registro de las peticiones recibidas (spy). Como el código llama con `fetch` global (`packages/platform/src/http.ts`, `apps/esb/src/app.ts`), basta con apuntar la URL del servicio a ese servidor. No se agregan dependencias (`nock` y `msw` descartados).

### 2.2 Snapshots, cobertura y estabilidad

- **Snapshots:** no se usan. Las respuestas se verifican con aserciones explícitas y con el esquema del contrato v3; un snapshot actualizado con `--updateSnapshot` sin revisar el diff anularía la prueba (PDF 9.1).
- **Cobertura:** sin mínimo y sin gate (ya resuelto). Se genera el reporte `--coverage` del proyecto `unit` como diagnóstico: al cerrar la fase 3 se revisan los módulos de `application/*` con menos cobertura y se decide, uno por uno, si merecen un caso nuevo.
- **Pruebas no intermitentes (flaky):**
  - Sin esperas fijas (`setTimeout`/`sleep`): los eventos del bus se esperan con sondeo y tiempo máximo.
  - Turnos E2E a +3 días de "ahora", lejos de medianoche en `America/Guayaquil` y del límite de 24 h. Los bordes de tiempo (justo antes y justo después de 24 h) solo se prueban en unitarias con reloj falso.
  - Cada archivo crea sus propios datos y su exchange/colas; integración y E2E corren con `--runInBand`.
  - No se usa `jest.retryTimes`. Una prueba intermitente se investiga; no se desactiva ni se reintenta.

**Nombres de casos:** `<proceso> · <condición> → <resultado esperado>`, por ejemplo `P7 · turno lleno → 409 OUT_OF_STOCK y cupos liberados`. Así cada caso se rastrea al proceso del inventario.

**Datos de prueba comunes** (`test/fixtures/v3/`): una categoría padre e hija con las tres banderas `incluye_*`, dos atracciones con tarifas por edad, un turno con aforo holgado, uno con 1 cupo (`ULTIMOS_CUPOS`) y uno lleno (`AGOTADO`), un socio con `X-API-Key` activa y otro inactivo, un turista con cédula válida.

---

## 3. Pruebas unitarias · 367

### 3.1 `packages/platform` · 64

| Módulo | # | Casos |
|---|---:|---|
| `problem-details.ts` | 6 | `AppError` → `toProblem` con `type`, `title`, `status`, `code`, `correlation_id`, `timestamp`; error desconocido → 500 sin filtrar detalle interno; conserva `errors` de validación |
| `formats.ts` | 8 | Amplía `formats.test.ts`: `zonedToUtc` en `America/Guayaquil`, fecha y hora inválidas, formato de fecha/hora del contrato, límites de día |
| `documents.ts` | 10 | Cédula válida, dígito verificador erróneo, provincia inexistente, longitud; RUC natural, privado y público; pasaporte; vacío |
| `principal.ts` | 6 | Firma y verificación; firma alterada; secreto distinto; principal vencido; campos faltantes; tipos socio y turista |
| `correlation.ts` | 4 | Reutiliza el `X-Correlation-Id` recibido; genera uno si falta; rechaza o normaliza uno inválido; lo propaga al contexto |
| `paging.ts` | 5 | Valores por defecto, máximo de página, `page`/`size` negativos o no numéricos, cálculo de totales |
| `contract.ts`, `contract-files.ts` | 5 | Amplía `contract-files.test.ts`: estados de reserva, los 4 tipos de evento, formato de `slot_id` válido e inválido |
| `esb-client.ts`, `rpc-http.ts`, `grpc.ts`, `http.ts` | 10 | Arma la ruta `servicio.operación`; agrega correlación y principal; respuesta ProblemDetails → `AppError` con el mismo `code`; timeout → error de servicio no disponible; cuerpo no JSON |
| `persistence/idempotency.ts`, `persistence/outbox.ts` | 6 | Con repositorio falso: clave nueva, clave repetida devuelve la respuesta guardada, clave en curso → `IDEMPOTENCY_IN_PROGRESS`, cuerpo distinto con la misma clave; outbox arma el evento con tipo y carga |
| `health.ts` | 4 | Todo UP; un crítico DOWN → DOWN; un opcional DOWN → sigue UP (degradado); timeout cuenta como DOWN |

### 3.2 Bordes · 74

| Componente / módulo | # | Casos |
|---|---:|---|
| **`apps/gateway`** | **20** | |
| `authentication.ts` | 10 | Sin credencial → 401; `Bearer` válido; `Bearer` mal formado; JWT vencido; `X-API-Key` válida; llave inactiva → 401/403 según contrato; ambas cabeceras (prioridad); caché de validación usada; caché vencida; ms-identity caído → 503 |
| `isContractPath` | 4 | Rutas `/api/v3/atracciones/*` del contrato sí; `/api/v2` y `/api/v1` no; rutas fuera del contrato no |
| Seguridad de cabeceras | 3 | Borra el principal interno que mande el cliente; no responde 429 (el contrato no lo define); reenvía `X-Correlation-Id` |
| `config.ts` | 3 | Valores por defecto, variable obligatoria faltante, secreto interno corto |
| **`apps/partner-api`** | **44** | |
| `routes.ts` | 4 | `/categorias/arbol`, `/search`, `/reservas` y `/promociones/contrato` se resuelven antes de `/:id`; método no permitido |
| `handlers/catalog.ts` | 8 | P1–P5: traducción de parámetros y query al ESB, filtros de búsqueda, paginación, `_links`, `404` de atracción, P6 parámetros de fecha |
| `handlers/reservations.ts` | 12 | P7 cuerpo válido, `Idempotency-Key` obligatoria, campos faltantes → 422; P8 `404`; P9 `solicitante` por defecto `SAGA_ORCHESTRATOR`, motivo; P10 datos del titular; mapeo de cada error del servicio al código HTTP del contrato |
| `handlers/events.ts` | 4 | P12 filtros por tipo y desde, paginación, lista vacía |
| `health.ts` | 5 | P13 nodos críticos y opcionales, 200 UP, 503 DOWN, formato del cuerpo |
| `request.ts`, `errors.ts`, `contract.ts` | 11 | Lectura de cabeceras, errores → `application/problem+json`, códigos del contrato |
| **`apps/esb`** | **10** | |
| `routes.ts` | 10 | Cada servicio del alcance resuelve su destino; operación desconocida → 404; parámetros a ruta, a query y a cuerpo; RPC a `/internal/rpc/<Método>`; correlación conservada |

### 3.3 Microservicios (`src/application/*`) · 229

| Servicio | # | Módulos y casos |
|---|---:|---|
| **ms-catalog** | **40** | `search` (10): cada filtro, combinación, sin resultados, orden, paginación · `attraction-service` (6): listado, ficha, inexistente · `attraction-mapper` (6): itinerario, punto de encuentro, tarifas por edad, valoraciones, `_links`, campos nulos · `attraction-input` (5) · `availability` (3) · `locations` (3) · `fields` (2) · `event-handlers` (5): `TARIFA_ACTUALIZADA` y `RESENA_PUBLICADA` actualizan la proyección, evento repetido, evento de atracción desconocida |
| **ms-inventory** | **16** | `availability` (6): umbral exacto de `DISPONIBLE` / `ULTIMOS_CUPOS` / `AGOTADO`, aforo 0, turno pasado · `slot-generator` (6): horizonte, días sin horario, no duplica, cambio de día en `America/Guayaquil` · `input` (4) |
| **ms-booking** | **67** | `purchase-flow` (12): camino feliz, falla en cada paso (turista, referencia, orden, cupos, pago) con compensación LIFO (`ReleaseSeats`, `CancelOrder`), compensación que también falla, `409 OUT_OF_STOCK` · `cancellation-flow` (12): estados que permiten y no permiten cancelar, plazo de 24 h (justo antes, justo después), `SAGA_ORCHESTRATOR`, reembolso completo, cupos devueltos, ya cancelada · `checkin-service` (6): titular válido, titular distinto, reserva usada, cancelada, vencida, fecha fuera de rango · `lifecycle` (5): `EXPIRED`, `COMPLETED`, cupos devueltos, evento `STOCK_ACTUALIZADO` · `event-publisher` (4) · `payment-events` (4) · `reservation-mapper` (5): respuesta del contrato, `_links`, PNR, `external_order_id` · `reservation-service` (4) · `voucher` (3): QR · `idempotency` (3) · `input` (6): incluido `400 SLOT_TIME_MISMATCH` · `remote` (3) |
| **ms-coupon** | **5** | `agreement`: lectura, actualización válida, valores fuera de rango, socio sin acuerdo, campos del contrato |
| **ms-identity** | **20** | `credential-validator` (4) · `tokens` (5): firma, vencimiento, emisor, claims · `api-client-service` (4): llave activa, inactiva, inexistente, comparación por hash · `client-service` (4): `ensureClient` crea, reutiliza, documento inválido, llama a billing-profile · `input` (3) |
| **ms-order** | **32** | `order-service` (6): orden del socio sin carrito ni cupón, estados · `payment-flow` (6) · `payment-methods` (3) · `payment-events` (4): aprobado, rechazado, repetido, orden inexistente · `totals` (5): suma por edades, redondeo, infante gratis · `stale-orders` (3) · `idempotency` (2) · `input` (3) |
| **ms-pricing** | **15** | `quote` (8): adulto, niño, senior, infante, límites de edad, mezcla, atracción sin tarifa, fecha sin vigencia · `price-table` (4) · `effective-tariffs-job` (3) |
| **ms-payment** | **13** | `payment-service` (5) · `webhook-processor` (5): aprobado, rechazado, firma inválida, repetido, pago desconocido · `input` (3) |
| **ms-refund** | **8** | `refund-service` (5): reembolso completo, sin pago aprobado, ya reembolsado · `refund-input` (3) |
| **ms-location** | **6** | `geography` (4), `input` (2) |
| **ms-billing-profile** | **3** | `profile-input`: perfil principal válido, duplicado, documento inválido |
| **ms-review** | **4** | `review-service`: publicación genera `RESENA_PUBLICADA`, calificación fuera de rango, reseña duplicada |

---

## 4. Pruebas de integración · 135

Cada prueba levanta solo lo que necesita: el servicio, su base `ms_*` migrada en el PostgreSQL embebido y, si aplica, el ESB, el bus u otro servicio real. Los servicios que no participan se sustituyen por dobles HTTP.

### 4.1 Persistencia (PostgreSQL) · 45

| Servicio | # | Casos |
|---|---:|---|
| ms-catalog | 4 | Árbol recursivo de categorías con banderas; búsqueda con filtros en SQL; ficha con inclusiones y guía; `sql-errors` traduce violación de unicidad |
| ms-inventory | 5 | Reserva con actualización condicional; **dos reservas concurrentes por el último cupo → solo una gana**; liberación; disponibilidad por fecha; horario |
| ms-booking | 5 | Transiciones de estado válidas e inválidas; reserva y evento en la misma transacción; feed ordenado y paginado; idempotencia guardada |
| ms-coupon | 2 | Lectura y actualización del acuerdo |
| ms-identity | 3 | Llave guardada como hash; turista de `ensureClient` único por documento; token |
| ms-order | 3 | Estados de la orden; outbox `OrdenPagada` en la misma transacción; idempotencia |
| ms-pricing | 2 | Tarifas vigentes por fecha; outbox `TARIFA_ACTUALIZADA` |
| ms-payment | 2 | Outbox `PagoAprobado` y `PagoRechazado` |
| ms-refund | 2 | Reembolso y outbox `ReembolsoEmitido`; un solo reembolso por orden |
| ms-location | 1 | Ciudades por provincia |
| ms-billing-profile | 2 | Un solo perfil principal por cliente (restricción) |
| ms-review | 2 | Reseña y outbox `RESENA_PUBLICADA` |
| Migraciones de los 12 servicios | 12 | Una por servicio: migran desde cero sobre su base `ms_*`, quedan las restricciones y claves foráneas esperadas |

### 4.2 Infraestructura compartida (`packages/platform`) · 16

| Módulo | # | Casos |
|---|---:|---|
| `persistence/idempotency.ts` | 3 | Misma clave → misma respuesta; clave en curso → `IDEMPOTENCY_IN_PROGRESS`; dos solicitudes simultáneas con la misma clave |
| `persistence/outbox.ts`, `outbox-relay.ts` | 3 | Rollback no deja evento; el relay publica una vez; el relay reintenta tras falla del bus |
| `messaging.ts` | 3 | Exchange y routing keys; cola por consumidor; mensaje no procesable |
| `esb-client.ts`, `rpc-http.ts` | 3 | Contra un ESB real: correlación de ida y vuelta, ProblemDetails propagado, timeout |
| `principal.ts` | 2 | Principal firmado por el Gateway aceptado por un servicio; principal alterado rechazado |
| `health.ts` | 2 | Servicio con base arriba y caída |

### 4.3 Transporte: Gateway, Partner API, ESB y servicios · 29

| Integración | # | Casos |
|---|---:|---|
| Gateway ↔ ms-identity | 5 | Sin credencial → `401` sin llamar a ms-identity; JWT válido; `X-API-Key` válida; llave inactiva; caché evita la segunda llamada |
| Gateway ↔ Partner API | 4 | Proxy de `/api/v3`, `X-Correlation-Id`, principal interno recibido, 503 si la Partner API no responde |
| Partner API ↔ ESB ↔ servicios | 8 | Un caso por handler (`catalog`, `reservations`, `events`, `health`) con servicios reales; error del servicio llega como ProblemDetails (`404` de ficha); correlación en todo el tramo; P7 `400 SLOT_TIME_MISMATCH`; P7 `422` |
| ESB ↔ servicios REST | 8 | Una operación representativa por servicio: ms-catalog, ms-coupon, ms-identity, ms-location, ms-payment, ms-refund, ms-billing-profile, ms-review. Con las 4 RPC, los 12 servicios quedan probados con su cableado real (rutas y dependencias registradas), lo que detecta un `500` por un componente mal registrado |
| ESB ↔ servicios RPC | 4 | `POST /internal/rpc/<Método>` de ms-booking, ms-order, ms-inventory y ms-pricing con los mensajes del `.proto` |

### 4.4 Colaboración entre microservicios (vía ESB) · 20

| Proceso parcial | # | Casos |
|---|---:|---|
| Saga de compra (P7) | 5 | Camino feliz; turno lleno → `ReleaseSeats` no aplica y `CancelOrder`; pago rechazado → cupos liberados y orden cancelada; ms-order caído a mitad; turista nuevo crea perfil principal |
| Orden del socio (P7) | 3 | Cotización por edad llega a la orden; cobro aprobado; cobro rechazado |
| Cancelación (P9) | 4 | Cupos devueltos, orden cancelada y reembolso emitido; fuera de plazo; ms-refund caído; ya cancelada |
| Consulta de reserva (P8) | 2 | Con turno y logística; turno inexistente |
| Check-in (P10) | 2 | Reserva ya usada; reserva cancelada |
| Búsqueda (P3) | 2 | Filtro por ciudad resuelto en ms-location; filtro por disponibilidad en ms-inventory |
| Salud agregada (P13) | 2 | Todos arriba; un crítico caído |

### 4.5 Eventos: productor → bus → consumidor · 16

| Integración | # | Casos |
|---|---:|---|
| Pago aprobado o rechazado | 3 | ms-payment → ms-order y ms-booking: aprobado confirma, rechazado compensa, orden de llegada invertida |
| Reembolso emitido | 2 | ms-refund → ms-order y ms-booking |
| Tarifa actualizada | 2 | ms-pricing → ms-catalog: la ficha muestra la tarifa nueva; tarifa futura no se aplica antes |
| Reseña publicada | 2 | ms-review → ms-catalog: promedio y cantidad de valoraciones |
| Eventos de reserva al feed | 2 | `RESERVA_CREADA` y `RESERVA_CONFIRMADA` aparecen en `listEvents` con el esquema `OutboxEventItem` |
| Reentrega del mismo evento | 5 | Uno por consumidor: procesar dos veces no cambia el resultado |

### 4.6 Procesos programados con su base · 9

| Proceso | # | Casos |
|---|---:|---|
| `lifecycle` | 3 | Reserva vencida → `EXPIRED` y cupos devueltos en ms-inventory; usada y pasada → `COMPLETED`; emite `STOCK_ACTUALIZADO` |
| `stale-orders` | 2 | Orden colgada cancelada; claves de idempotencia vencidas borradas |
| `slot-generator` | 2 | Genera turnos hacia adelante; segunda ejecución no duplica |
| `effective-tariffs-job` | 2 | Activa la tarifa que entra en vigencia; publica el evento |

---

## 5. Pruebas E2E · 19

Sistema completo levantado en proceso con un harness nuevo en `test/system/v3/`, solo con los componentes de la sección 0.2 del inventario (Gateway, Partner API, ESB y los 12 `ms-*`), cada uno con su base `ms_*`. No levanta servicios heredados ni `booking-mock`. El harness actual (`test/system/harness.ts`) y las pruebas `fase1`–`fase7` no se modifican. Se llama al Gateway `/api/v3` con `X-API-Key` o JWT, como Booking. Cada caso verifica código HTTP, cuerpo contra el esquema del contrato v3, `X-Correlation-Id` y, en errores, `application/problem+json`.

Un E2E por proceso, más los únicos casos que solo se ven con el sistema entero: la compensación de la saga vista desde fuera, la idempotencia de punta a punta, el feed después de la compra y la cancelación, y la salud con un nodo caído.

| Proceso | # | Casos |
|---|---:|---|
| P1 Árbol de categorías | 1 | Árbol con las banderas `incluye_comida`, `incluye_transporte`, `incluye_guia` |
| P2 Categorías | 1 | Listado plano |
| P3 Búsqueda avanzada | 1 | Filtros combinados con paginación |
| P4 Listado de atracciones | 1 | Página con `_links` HATEOAS |
| P5 Ficha técnica | 1 | Ficha completa (itinerario, punto de encuentro, tarifas por edad, valoraciones) |
| P6 Disponibilidad | 1 | Estado y cupos del turno antes de comprar |
| P7 Compra | 3 | `201` con `external_order_id`, PNR y QR, y la disponibilidad baja; `409 OUT_OF_STOCK` y el cupo sigue igual (compensación); misma `Idempotency-Key` → misma respuesta |
| P8 Consulta de reserva | 1 | La reserva recién creada |
| P9 Cancelación | 1 | `SAGA_ORCHESTRATOR` con reembolso; la disponibilidad sube |
| P10 Check-in | 1 | Titular válido |
| P11 Acuerdo de promociones | 1 | `PUT` y nuevo `GET` refleja el cambio |
| P12 Feed Outbox | 1 | Tras compra y cancelación aparecen `RESERVA_CREADA`, `RESERVA_CONFIRMADA`, `STOCK_ACTUALIZADO` y `RESERVA_CANCELADA` |
| P13 Salud | 2 | `200` UP; `503` DOWN con un nodo crítico detenido |
| T1 Autenticación | 2 | Sin credencial `401`; `X-API-Key` válida |
| T2 Cabeceras y errores | 1 | `X-Correlation-Id` enviado vuelve igual y uno ausente se genera; un error trae `application/problem+json`, `code`, `correlation_id`, `timestamp` |

**Recorridos encadenados:** P6 → P7 → P8 → P10 y P7 → P9 → P12 se ejecutan en orden dentro de un mismo archivo para reutilizar la reserva creada; cada archivo crea sus propios datos y no depende de otro.

### 5.1 Casos que bajaron de nivel

| Caso quitado del E2E | Dónde queda cubierto |
|---|---|
| P1 categoría sin hijas | 3.3 ms-catalog · 4.1 árbol recursivo |
| P3 paginación sola; sin resultados | 3.3 `search` · 4.1 búsqueda en SQL · 4.4 Búsqueda (P3) |
| P4 paginación | 3.1 `paging.ts` · 3.2 `handlers/catalog.ts` |
| P5 `404` | 3.2 `handlers/catalog.ts` · 4.3 Partner API ↔ ESB |
| P6 `DISPONIBLE`, `ULTIMOS_CUPOS`, `AGOTADO` | 3.3 `availability` (umbrales exactos) · 4.1 disponibilidad por fecha |
| P7 `400 SLOT_TIME_MISMATCH`; `422` | 3.3 `input` · 3.2 `handlers/reservations.ts` · 4.3 Partner API ↔ ESB |
| P8 `404` | 3.2 `handlers/reservations.ts` · 4.4 Consulta de reserva |
| P9 fuera de plazo; ya cancelada | 3.3 `cancellation-flow` (reloj falso) · 4.4 Cancelación |
| P10 ya usada; cancelada | 3.3 `checkin-service` · 4.4 Check-in (P10) |
| P11 `GET` solo | Incluido en el caso `PUT` + `GET` |
| T1 JWT válido; `X-API-Key` inactiva | 3.2 `authentication.ts` · 4.3 Gateway ↔ ms-identity |
| T2 en dos casos | Unido en un caso |

---

## 6. Orden de implementación

| Fase | Contenido | Nivel | Salida |
|---|---|---|---|
| 1 | Configuración: proyecto Jest `integration`, script `test:integration`, fixtures `test/fixtures/v3`, helper de base `ms_*` migrada | — | Suites vacías que corren |
| 2 | `packages/platform` y bordes (3.1, 3.2) | Unitarias | 138 |
| 3 | `application/*` de los 12 servicios (3.3), empezando por ms-booking, ms-inventory y ms-order; al cerrar, revisión del reporte de cobertura | Unitarias | 229 |
| 4 | Persistencia e infraestructura (4.1, 4.2) | Integración | 61 |
| 5 | Transporte, colaboración, eventos y procesos programados (4.3–4.6) | Integración | 74 |
| 6 | Harness E2E sobre los `ms-*` y casos de la sección 5 | E2E | 19 |
| 7 | Workflow de CI (sección 6.1) y, tras su primera corrida, activar los required status checks en `main` | CI | 1 archivo nuevo + ajuste del repositorio |

Cada fase empieza cuando la anterior está en verde.

### 6.1 CI (GitHub Actions)

Archivo nuevo: `.github/workflows/pruebas.yml`. No modifica `deploy-azure.yml` ni `azure-static-web-apps-*.yml`, y el despliegue no espera a las pruebas: si fallan, el despliegue sigue igual que hoy.

| Tema | Definición |
|---|---|
| Cuándo corre | `push` y `pull_request` a `main`, y a mano (`workflow_dispatch`) |
| Máquina | `ubuntu-latest`, Node 22, `npm ci` (igual que `deploy-azure.yml`) |
| Jobs | `lint` → `unit` → `integration` → `e2e` encadenados con `needs:`, en orden de fallo rápido (lo más rápido y barato primero, PDF 9.5): si falla un paso no se corre el siguiente. `lint` ejecuta el `npm run lint` que ya existe (`tsc --noEmit`). La verificación Pact irá después de `e2e`, en su propio plan |
| PostgreSQL | `embedded-postgres`, el mismo de local; no necesita servicio aparte |
| RabbitMQ | Contenedor de servicio `rabbitmq:3.13-management-alpine` (la misma imagen de `infra/docker-compose.yml`) solo dentro de los jobs `integration` y `e2e`, en `localhost:5672` |
| Secretos | Ninguno: los secretos de prueba son valores fijos de la suite; no usa los de Azure ni los datos del RabbitMQ real |
| Resultado | Reporte de Jest de cada job en la pestaña Actions; el reporte de cobertura del job `unit` se sube como artefacto (informativo, no bloquea) |
| Gate de calidad | "Required status checks" en la protección de la rama `main` (Settings → Branches en GitHub): los jobs `lint`, `unit`, `integration` y `e2e` deben estar en verde para fusionar un PR. Es un ajuste del repositorio, no un archivo. Limitación: no bloquea un `push` directo a `main` ni el despliegue de `deploy-azure.yml`, que siguen como hoy. El ajuste lo activa quien administre el repositorio, después de que `pruebas.yml` haya corrido una vez (GitHub solo ofrece checks que ya existen) |

---

## 7. Criterios de aceptación

1. Las tres suites pasan en verde con `npm run test:unit`, `npm run test:integration` y `npm run test:e2e`.
2. Se cumple la pirámide en número de casos: unitarias > integración > E2E, con el E2E limitado a los flujos críticos de la sección 5.
3. Todo caso quitado del E2E tiene su cobertura según la tabla 5.1.
4. Las pruebas siguen las reglas de dobles de la sección 2.1 (ninguna dobla la unidad bajo prueba) y no usan esperas fijas ni reintentos (2.2).
5. Cada proceso P1–P13 y T1–T2 tiene al menos un caso en cada nivel donde el inventario lo lista (o en el nivel más bajo indicado en la tabla 5.1).
6. No se exige un porcentaje mínimo de cobertura; el reporte se genera como diagnóstico.
7. Ninguna prueba toca algo de la sección 0.3 del inventario.
8. `git diff` final solo muestra archivos nuevos de prueba, `jest.config.js`, `package.json` (script `test:integration`) y `.github/workflows/pruebas.yml`; ningún archivo de código del proyecto cambia.

---

## 8. Preguntas abiertas

**Resueltas:**
- Harness E2E: uno nuevo solo con los `ms-*`; el actual no se toca.
- Integración: proyecto Jest nuevo `integration`.
- Cobertura: sin mínimo.
- CI: sí, con GitHub Actions (sección 6.1).
- Bus de eventos: RabbitMQ local en Docker, con la condición de no cambiar nada del código (sección 2).

- E2E: 19 casos de flujos críticos; las variantes del inventario bajan a unitarias e integración según la tabla 5.1.
- Gate de calidad: "required status checks" en la protección de `main` (sección 6.1).
- Lint en CI: sí, job `lint` antes de `unit`.
- Dobles HTTP en integración: servidor HTTP falso en proceso con `node:http`, sin dependencias nuevas.
- Mutation testing (Stryker): fuera del plan.

No quedan preguntas pendientes.
