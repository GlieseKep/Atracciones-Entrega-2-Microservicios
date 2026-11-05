# Plan de implementación · Clientes compartidos y check-in notificado a Booking

| | |
|---|---|
| Requisitos | (1) Atracción con cupos creada en la web, reservada desde Booking, cupos descontados en la web. (2) El turista creado en Booking existe una sola vez en nuestro sistema, y el check-in presencial se notifica a Booking Central. |
| Servicios que cambian | `ms-identity`, `ms-billing-profile`, `ms-booking`, `esb`, `partner-api`, `gateway`, `booking-mock`, `AtraccionesService-web` |
| Contrato de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` (no trae `/clientes`; se agrega como extensión pedida por Booking) |
| Fecha | 2026-11-05 |

## 1. Estado actual

| Requisito | Estado | Dónde |
|---|---|---|
| Crear atracción en la web | Hecho | `AdminCatalogPage` → `catalogAdmin.create` |
| Crear y editar cupos en la web | Hecho | `AdminAvailabilityPage` → `POST /admin/availability`, `PATCH /admin/availability/{id}` |
| Reserva desde Booking descuenta cupos | Hecho | `PurchaseFlow` → `inventory.reserveSeats` (se compensa con `releaseSeats`) |
| `GET/POST /api/v3/clientes` | **Falta** | No existe la ruta ni un `client_id` |
| Turista sin duplicar | **Falta** | El titular solo se guarda en `reserva_pasajero`, una copia por reserva |
| Check-in presencial | Hecho (API) | `POST /atracciones/reservas/{id}/checkin` → `CheckinService` |
| Aviso del check-in a Booking Central | **Falta** | No se llama a `booking-core-api` |
| Pantalla de check-in para el guía | **Falta** | La web solo le muestra el QR al turista |

El punto 1 no necesita código: solo se comprueba con el guion de la sección 8.

## 2. Decisiones

Confirmadas por el usuario:

1. **El turista se registra en `cliente_api` de `ms-identity`, no en `usuario`.** No se crea ninguna cuenta web ni contraseña, y no se usa `usu_id`. El turista queda enlazado a sus datos de facturación (`dato_facturacion` de `ms-billing-profile`).

Consecuencias de esa decisión:

2. **`cliente_api` guarda dos tipos de fila**, que se distinguen por `cla_tipo`:
   - `SOCIO`: los sistemas que ya existen (Booking), con `X-API-Key`.
   - `TURISTA`: los clientes que registra un socio, **sin clave**. Nunca pueden autenticarse: `validateApiKey` y la lista admin de clientes API filtran `cla_tipo = 'SOCIO'`.
3. **`dato_facturacion` se enlaza por `usu_id` o por `cla_id`.** Hoy `usu_id` es `NOT NULL`. Pasa a aceptar `NULL`, con una columna nueva `cla_id` y la regla "exactamente uno de los dos", la misma que ya usa `orden` en `ms-order`.
4. **Un turista de Booking y un usuario de la web son personas distintas** aunque compartan correo. La unicidad se garantiza solo entre turistas de `cliente_api`.

Propuestas (a confirmar antes de programar):

5. **`client_id` = `cla_id`.** En la base es `BIGINT GENERATED ALWAYS AS IDENTITY`, la columna que ya existe. Solo en el JSON se escribe como texto (ej. `"42"`), porque así lo muestra el ejemplo de Booking.
6. **Identificadores secuenciales.** Todo ID nuevo o reutilizado (`cla_id`, `dfa_id`, `res_id`) es `BIGINT GENERATED ALWAYS AS IDENTITY`. PostgreSQL asigna el valor en el mismo `INSERT ... RETURNING`, sin un `SELECT` previo para calcular el siguiente. Ningún ID es texto armado a mano. Las columnas que guardan el ID de otro servicio (`dato_facturacion.cla_id`, `reserva.cla_id_cliente`) son `BIGINT`.
7. **Unicidad.** Índices únicos parciales sobre `cla_correo` y `cla_identificacion` para `cla_tipo = 'TURISTA'`. Un cliente se identifica por el correo **o** por la identificación:
   - los dos datos apuntan al mismo turista, o solo uno coincide → es ese turista;
   - el correo es de un turista y la identificación de otro → `409 CLIENT_DATA_CONFLICT` (no se fusionan automáticamente).
8. **`POST /clientes` es idempotente por datos:** si el cliente ya existe, responde `200 OK` con el `client_id` existente en lugar de duplicarlo. Si es nuevo, `201 Created`.
9. **Datos del turista.** `nombre` se guarda tal cual en `cla_nombre` (al menos dos palabras, la misma regla que `customer.full_name` en las reservas). La identificación acepta cédula (10 dígitos, validada) o pasaporte `^[A-Z0-9]{6,9}$`, igual que en las reservas. El RUC (13 dígitos) no identifica a una persona y se responde `422`. `cla_codigo` (obligatorio y único en la tabla actual) se llena con `TUR-<identificacion>`, armado con los datos del cuerpo. No es un ID ni se usa para relacionar tablas, y no necesita consultar la base.
10. **Rol `GUIA`.** `ms-identity` solo tiene `ADMIN`, `OPERADOR` y `CLIENTE`. Se agrega `GUIA` para que el guía haga el check-in desde la web sin permisos de operador.
11. **El aviso a Booking pasa por el ESB**, como el SRI: un destino externo `booking_core` con su propia `X-API-Key`. Así el aviso tiene plazo y circuit breaker, y `ms-booking` no conoce URLs externas.
12. **El check-in no depende de Booking.** El check-in local se confirma siempre. El aviso se guarda como pendiente en la misma transacción, se intenta enviar al momento y, si falla, se reintenta en segundo plano.
13. **Solo se avisan las reservas que vinieron de Booking** (`reserva.res_canal = 'SOCIO'`, que se fija al comprar con `X-API-Key`). Se guarda en la reserva porque el guía no tiene permiso para leer la orden. Las compras de la web no se notifican.

## 3. Módulo de clientes (`ms-identity` + `ms-billing-profile`)

### 3.1 Base de datos de `ms-identity`

Migración nueva `1796000000200-ClientesTuristas.ts` (no se edita la migración inicial, que ya está desplegada):

```sql
ALTER TABLE cliente_api ADD COLUMN cla_tipo VARCHAR(10) NOT NULL DEFAULT 'SOCIO'
    CONSTRAINT cliente_api_tipo_valido CHECK (cla_tipo IN ('SOCIO', 'TURISTA'));
ALTER TABLE cliente_api ALTER COLUMN cla_clave_hash DROP NOT NULL;
ALTER TABLE cliente_api
    ADD COLUMN cla_correo         dom_correo,
    ADD COLUMN cla_identificacion VARCHAR(20),
    ADD COLUMN cla_telefono       dom_telefono,
    ADD COLUMN cla_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cliente_api ADD CONSTRAINT cliente_api_datos_por_tipo CHECK (
    (cla_tipo = 'SOCIO'   AND cla_clave_hash IS NOT NULL) OR
    (cla_tipo = 'TURISTA' AND cla_clave_hash IS NULL
                          AND cla_correo IS NOT NULL AND cla_identificacion IS NOT NULL
                          AND (cla_identificacion ~ '^[0-9]{10}$' OR cla_identificacion ~ '^[A-Z0-9]{6,9}$'))
);
CREATE UNIQUE INDEX ux_cliente_api_turista_correo ON cliente_api (lower(cla_correo)) WHERE cla_tipo = 'TURISTA';
CREATE UNIQUE INDEX ux_cliente_api_turista_identificacion ON cliente_api (cla_identificacion) WHERE cla_tipo = 'TURISTA';
CREATE TRIGGER trg_cliente_api_actualizado BEFORE UPDATE ON cliente_api
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('cla_actualizado_en');
INSERT INTO rol (rol_nombre, rol_descripcion)
    VALUES ('GUIA', 'Guía que valida el check-in en el punto de encuentro');
```

`UNIQUE (cla_clave_hash)` se mantiene: PostgreSQL permite varios `NULL`.

Se actualizan también `Plan/ms_identity/ms_identity.sql` y la sección 1 de `Plan/02_microservicios_v2_bases_de_datos.sql`, para que el diseño siga igual al código.

### 3.2 Lógica (`application/client-service.ts`, nuevo)

- `find({ email, identificacion })`: necesita al menos uno (si no, `400`). Busca entre las filas `TURISTA`: `lower(cla_correo) = lower(email) OR cla_identificacion = upper(identificacion)`.
  0 filas → `404 CLIENT_NOT_FOUND`; 2 turistas distintos → `409 CLIENT_DATA_CONFLICT`; 1 → el cliente.
- `ensure({ nombre, email, identificacion, telefono })`: valida (correo, teléfono E.164 o `09XXXXXXXX`, identificación, nombre de dos palabras).
  Si `find` encuentra al cliente lo devuelve (`creado: false`). Si no, inserta la fila `TURISTA` sin clave con `INSERT ... RETURNING cla_id` (`creado: true`): la identidad genera el ID sin consultar antes.
  Si dos peticiones lo crean a la vez, la segunda choca con el índice único (`23505`): se vuelve a leer y se devuelve el existente.
- En los dos casos llama a `billing.ensurePrincipalForClient` (sección 3.4). Si esa llamada falla, responde `503`, pero el turista ya quedó creado: el siguiente `POST` lo encuentra y completa los datos de facturación.
- `api-client-service` y `api-client-repository`: `validateApiKey`, `listApiClients`, `createApiClient` y `setApiClientActive` trabajan solo con `cla_tipo = 'SOCIO'`. Un `TURISTA` no se puede activar como socio ni recibir clave.
- `api-client-repository`: métodos nuevos `findTourist` y `createTourist`.

Respuesta común (`GET` y `POST`):

```json
{ "client_id": "42", "nombre": "Ana María Pérez", "email": "ana@correo.com", "identificacion": "1712345678" }
```

### 3.3 Rutas

| Capa | Ruta | Destino |
|---|---|---|
| Partner API (pública) | `GET /api/v3/clientes?email=&identificacion=` | `esb.call('identity', 'findClient')` → 200 / 404 / 409 |
| Partner API (pública) | `POST /api/v3/clientes` | `esb.call('identity', 'createClient')` → 201 (nuevo) / 200 (existente) |
| ESB → `ms-identity` | `identity.findClient`: `GET /api/v3/clientes` | `client-service.find` |
| ESB → `ms-identity` | `identity.createClient`: `POST /api/v3/clientes` | `client-service.ensure` |
| ESB → `ms-identity` (interno) | `identity.ensureClient`: `POST /api/v3/internal/clientes` (`X-Service-Token`) | La usa `ms-booking` al reservar |

Las rutas públicas se registran en `apps/partner-api/src/routes.ts` con su handler `handlers/clients.ts`. La ruta admin existente `/clientes-api` sigue siendo solo para socios; no se mezcla con `/clientes`.

Permisos: solo un socio con `X-API-Key` o un `ADMIN`. En `apps/gateway/src/authentication.ts` se agregan `clients:read` y `clients:write` a `PARTNER_SCOPES`, y la Partner API exige esos scopes en las dos rutas.

### 3.4 Datos de facturación (`ms-billing-profile`)

Migración nueva `1796000000400-FacturacionClienteApi.ts`:

```sql
ALTER TABLE dato_facturacion ALTER COLUMN usu_id DROP NOT NULL;
ALTER TABLE dato_facturacion ADD COLUMN cla_id BIGINT;            -- ID lógico (Identity, cliente_api TURISTA)
ALTER TABLE dato_facturacion ADD CONSTRAINT dato_facturacion_un_titular
    CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL));
ALTER TABLE dato_facturacion ADD CONSTRAINT uq_dato_facturacion_cliente_identificacion
    UNIQUE (cla_id, dfa_tipo_identificacion, dfa_identificacion);
CREATE UNIQUE INDEX ux_dato_facturacion_principal_cliente
    ON dato_facturacion (cla_id) WHERE dfa_es_principal AND cla_id IS NOT NULL;
CREATE INDEX ix_dato_facturacion_cla_id ON dato_facturacion (cla_id);
```

El índice `ux_dato_facturacion_principal` sobre `usu_id` sigue igual. Las filas con `usu_id` `NULL` no chocan entre sí, porque PostgreSQL no compara `NULL` en un índice único.

Rutas internas nuevas:

- `billing.ensurePrincipalForClient`: `POST /internal/clientes/:claId/datos-facturacion/principal`. Si el turista no tiene un `dato_facturacion` activo con esa identificación, lo crea: `dfa_tipo_identificacion` = `CEDULA` o `PASAPORTE`, `dfa_razon_social` = nombre, `dfa_correo`, `dfa_telefono`. Si no tiene otro principal, lo marca `dfa_es_principal = true`. Si ya existe, no cambia nada. Así es idempotente y Identity la puede llamar cada vez.
- `billing.getPrincipalForClient`: `GET /internal/clientes/:claId/datos-facturacion/principal`, para facturar una reserva de Booking a nombre del turista.

Las rutas `/usuarios/me/datos-facturacion` no cambian: siguen filtrando por `usu_id`.

## 4. Reserva enlazada al cliente (`ms-booking`)

- Migración `1796000001200-ReservaCliente.ts`: `ALTER TABLE reserva ADD COLUMN cla_id_cliente BIGINT;` (ID lógico de Identity, el `TURISTA`; `NULL` en compras web y en las reservas anteriores) más su índice, y `res_canal` (`WEB` o `SOCIO`). El nombre es distinto de `cla_id` en `orden` porque allí `cla_id` es el socio que compra, no el turista. Si el titular viene con RUC, la reserva queda `SOCIO` pero sin turista enlazado (el RUC no identifica a una persona).
- El cuerpo de la reserva no cambia: Booking no tiene que mandar ningún campo nuevo.
- `PurchaseFlow.purchase`, solo cuando el principal es un socio (`API_CLIENTE`), antes de crear la orden, llama a `identity.ensureClient` con los datos del `customer` que ya llegan (nombre, correo, documento, teléfono). Si el turista ya existe (porque Booking llamó antes a `/clientes` o reservó otra vez), se reutiliza; si no, se crea.

  Así, aunque Booking no llame antes a `/clientes`, el turista nunca se duplica. Las compras web siguen igual (orden con `usu_id`).
- `reservation-mapper`: la respuesta de la reserva incluye `client_id`, un campo extra del contrato que no rompe a quien no lo lea.
- `remote.ts`: método `ensureClient`.

## 5. Aviso del check-in a Booking Central

### 5.1 ESB

- `apps/esb/src/app.ts`: destino `booking_core` con `BOOKING_CORE_URL` (por defecto `http://127.0.0.1:4090`, el `booking-mock`).
- `RestRoute` gana un campo opcional `auth?: 'service-token' | 'partner-api-key'`. Para `partner-api-key`, el ESB manda `X-API-Key: BOOKING_CORE_API_KEY` y **no** manda `X-Service-Token` (que es un secreto interno).
- Ruta nueva en `routes.ts`:
  `'bookingCore.notifyCheckin': { protocol: 'rest', target: 'booking_core', method: 'POST', path: '/api/v3/reservas/:external_order_id/checkin', auth: 'partner-api-key', timeoutMs: 8000 }`.

### 5.2 `ms-booking`

Migración `1796000001200-ReservaCliente.ts` (la misma de la sección 4) agrega:

```sql
CREATE TABLE notificacion_checkin (
    res_id            BIGINT       PRIMARY KEY REFERENCES reserva (res_id) ON DELETE CASCADE,
    nch_payload       JSONB        NOT NULL,
    nch_intentos      INTEGER      NOT NULL DEFAULT 0,
    nch_ultimo_error  VARCHAR(500),
    nch_proximo_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_enviado_en    TIMESTAMPTZ,
    nch_creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_notificacion_checkin_pendiente ON notificacion_checkin (nch_proximo_en) WHERE nch_enviado_en IS NULL;
```

- `CheckinService.checkIn`: en la misma transacción que pasa la reserva a `CHECKED_IN`, si la reserva vino de Booking (decisión 13), inserta el aviso con este cuerpo:

  ```json
  {
    "external_order_id": "<ord_numero>",
    "client_id": "<cla_id_cliente>",
    "estado": "CONFIRMADO_ASISTIDO",
    "asistentes_reales": "<asistentes_reales del body, o res_numero_tickets>",
    "admin_id": "<guia_codigo, o 'guia-turistico'>",
    "fecha_checkin": "<res_checkin_en en ISO 8601>",
    "observaciones": "<observaciones del body, o 'Turista validado en punto de encuentro con código QR y cédula física'>"
  }
  ```

  `external_order_id` es el mismo que devolvimos al crear la reserva (`ord_numero`), y va en la URL y en el cuerpo. `asistentes_reales` y `observaciones` son campos opcionales nuevos del body del check-in.
- Después de confirmar la transacción, `CheckinNotifier.send(resId)` lo intenta una vez. La respuesta del check-in no espera a Booking: un fallo solo deja el aviso pendiente.
- `application/checkin-notifier.ts` (nuevo), con el temporizador de `Lifecycle`. Cada minuto toma hasta 50 avisos pendientes con `nch_proximo_en <= now()`, los envía por `esb.call('bookingCore', 'notifyCheckin')` y marca `nch_enviado_en`. Si falla, suma un intento y espera más la siguiente vez (1, 2, 4… hasta 60 minutos). Se deja de reintentar a los 15 intentos y se registra un error en el log.
- Un `409` de Booking con el check-in ya registrado cuenta como enviado.
- `ListReservations` y la respuesta admin incluyen `notificacion_booking`: `NO_APLICA`, `PENDIENTE`, `ENVIADA` o `FALLIDA`.
- `CheckinService.assertStaff`: además de `ADMIN`, `OPERADOR` y socio, acepta el rol `GUIA` (decisión 10).

### 5.3 `booking-mock`

Recibe `POST /api/v3/reservas/:id/checkin`, comprueba la `X-API-Key`, guarda el cuerpo en `/received` y responde `{"acknowledged": true, "status": "CONFIRMADO_ASISTIDO"}`. Sirve para probar en local sin tocar Booking Central.

## 6. Pantalla de check-in en la web (`AtraccionesService-web`)

- Ruta `/admin/checkin` (`AdminCheckinPage.tsx`), visible para `ADMIN`, `OPERADOR` y `GUIA`. En `AdminLayout` se agrega el enlace; el guía solo ve esta opción.
- Pasos:
  1. Escanear el QR con la cámara (`BarcodeDetector` si el navegador lo tiene) o escribir el código de reserva (`DEC-XXXXXX`).
  2. Se muestra la reserva (`GET /atracciones/reservas/{id}`, que ya acepta UUID o código): titular, atracción, turno, boletos y estado.
  3. El guía escribe el documento que le muestra el turista, los asistentes reales (por defecto, los boletos) y observaciones opcionales.
  4. "Confirmar asistencia" → `POST /atracciones/reservas/{id}/checkin` con un `Idempotency-Key` nuevo.
  5. Resultado: estado `CHECKED_IN`, guía, punto de encuentro, pase de abordar (QR) y el estado del aviso a Booking.
- `src/api/bookings.ts`: `checkIn(id, body, idempotencyKey)`.
- El estado del aviso a Booking se ve en la pantalla de check-in. La columna "Aviso a Booking" en la lista de reservas del admin queda pendiente: esa lista usa la API admin anterior, que no lee de `ms-booking`.
- Los mensajes de error usan los códigos del backend: `DOCUMENT_MISMATCH`, `INVALID_VOUCHER`, `RESERVATION_NOT_CONFIRMED` y `CHECKIN_OUT_OF_WINDOW`.

## 7. Configuración y despliegue

| Variable | Dónde | Valor |
|---|---|---|
| `BOOKING_CORE_URL` | ESB | `https://booking-core-api.azurewebsites.net` (local: `http://127.0.0.1:4090`) |
| `BOOKING_CORE_API_KEY` | ESB | La clave que Booking nos registró (secreto de GitHub y App Setting de Azure) |
| `CHECKIN_NOTIFY_INTERVAL_MS` | ms-booking | `60000` |

Se agregan a `start-microservices.ps1`, a los `.env.example` y al workflow de despliegue, como los demás secretos.

## 8. Orden de trabajo

Según la preferencia del proyecto, no se escriben ni ejecutan pruebas: cada paso se cierra compilando con `tsc`.

1. `ms-identity`: migración de `cliente_api`, `client-service`, rutas, filtro `SOCIO` en las operaciones de clientes API, rol `GUIA`. Actualizar el SQL de `Plan/`.
2. `ms-billing-profile`: migración con `cla_id`, `ensurePrincipalForClient` y `getPrincipalForClient`. Actualizar el SQL de `Plan/`.
3. `esb`: rutas de identity y billing nuevas, destino `booking_core`, `auth: 'partner-api-key'`.
4. `gateway` y `partner-api`: scopes y rutas `/clientes`.
5. `ms-booking`: migración, enlace reserva ↔ cliente, aviso y reintentos, rol `GUIA`.
6. `booking-mock`: receptor del check-in.
7. Web: `AdminCheckinPage`, API y columna de aviso.
8. Variables de entorno y workflow.

### Guion de demostración

1. **Punto 1.** Admin web → "Nueva atracción" → crear un turno con 10 cupos. Booking reserva 2 → en "Disponibilidad" el turno muestra 8.
2. **Punto 2, cliente.** Booking llama `GET /clientes?email=…` (404) y luego `POST /clientes` (201, `client_id`). Un segundo `POST` con los mismos datos responde 200 con el mismo `client_id`. En la base, `cliente_api` tiene una sola fila `TURISTA` y `dato_facturacion` una fila principal con ese `cla_id`. Booking reserva con los mismos datos del titular, y la reserva devuelve ese mismo `client_id` sin crear otro turista.
3. **Punto 2, check-in.** El guía entra a `/admin/checkin`, escanea el QR, escribe la cédula y confirma. La reserva queda `CHECKED_IN`, el aviso pasa a `ENVIADA` y Booking responde `{"acknowledged": true}`. En local se ve en `booking-mock /received`.
