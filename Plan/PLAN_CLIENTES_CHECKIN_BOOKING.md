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

1. **El cliente es un `usuario` de `ms-identity` con el rol `CLIENTE`**, enlazado a sus datos de facturación (`dato_facturacion` de `ms-billing-profile`, por `usu_id`). No se crea una tabla nueva de clientes.

Propuestas (a confirmar antes de programar):

2. **`client_id` = `usu_id` como texto** (ej. `"42"`). El contrato v3 no expone IDs de usuario, pero Booking necesita uno estable.
3. **Cuenta sin contraseña.** Un turista que llega desde Booking no tiene contraseña. `usu_password` pasa a aceptar `NULL` solo cuando `usu_origen = 'BOOKING'`. Esa cuenta no puede iniciar sesión hasta que el turista use "recuperar contraseña" (que ya existe) para ponerle una. Así, si después se registra en la web con el mismo correo, se le ofrece recuperar la cuenta en lugar de crear otra.
4. **Unicidad.** Ya existen `UNIQUE (usu_correo)` y `UNIQUE (usu_documento)`. Un cliente se identifica por el correo **o** por la identificación:
   - los dos datos apuntan al mismo usuario, o solo uno coincide → es ese usuario;
   - el correo es de un usuario y la identificación de otro → `409 CLIENT_DATA_CONFLICT` (no se fusionan cuentas automáticamente).
5. **`POST /clientes` es idempotente por datos:** si el cliente ya existe, responde `200 OK` con el `client_id` existente en lugar de duplicarlo. Si es nuevo, `201 Created`.
6. **Nombre.** Booking manda `nombre` en un solo campo. Se separa en `usu_nombre` (primera palabra) y `usu_apellido` (el resto). Se exigen al menos dos palabras, la misma regla que ya usa `customer.full_name` en las reservas.
7. **Identificación.** `dom_documento` hoy acepta cédula (10 dígitos) y pasaporte `^[A-Z]{1,2}[0-9]{6,9}$`. Las reservas aceptan pasaporte `^[A-Z0-9]{6,9}$`. Se amplía `dom_documento` a `^[A-Z0-9]{6,9}$` para pasaportes, y así un pasaporte que pasa en la reserva también pasa en `/clientes`. El RUC (13 dígitos) no identifica a una persona y se responde `422`.
8. **Rol `GUIA`.** `ms-identity` solo tiene `ADMIN`, `OPERADOR` y `CLIENTE`. Se agrega `GUIA` para que el guía haga el check-in desde la web sin tener permisos de operador.
9. **El aviso a Booking pasa por el ESB**, como el SRI: un destino externo `booking_core` con su propia `X-API-Key`. Así el aviso tiene plazo y circuit breaker, y `ms-booking` no conoce URLs externas.
10. **El check-in no depende de Booking.** El check-in local se confirma siempre. El aviso se guarda como pendiente en la misma transacción, se intenta enviar al momento y, si falla, se reintenta en segundo plano.
11. **Solo se avisan las reservas que vinieron de Booking** (la orden tiene `cla_id`, o la reserva tiene `res_saga_id`). Las compras de la web no se notifican.

## 3. Módulo de clientes (`ms-identity` + `ms-billing-profile`)

### 3.1 Base de datos de `ms-identity`

Migración nueva `1796000000200-ClientesBooking.ts` (no se edita la migración inicial, que ya está desplegada):

```sql
ALTER TABLE usuario ADD COLUMN usu_origen VARCHAR(10) NOT NULL DEFAULT 'WEB'
    CONSTRAINT usuario_origen_valido CHECK (usu_origen IN ('WEB', 'BOOKING'));
ALTER TABLE usuario ALTER COLUMN usu_password DROP NOT NULL;
ALTER TABLE usuario ADD CONSTRAINT usuario_password_requerida
    CHECK (usu_password IS NOT NULL OR usu_origen = 'BOOKING');
ALTER DOMAIN dom_documento DROP CONSTRAINT dom_documento_check;
ALTER DOMAIN dom_documento ADD CONSTRAINT dom_documento_check
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[A-Z0-9]{6,9}$');
INSERT INTO rol (rol_nombre, rol_descripcion)
    VALUES ('GUIA', 'Guía que valida el check-in en el punto de encuentro');
```

Se actualizan también `Plan/ms_identity/ms_identity.sql` y la sección 1 de `Plan/02_microservicios_v2_bases_de_datos.sql`, para que el diseño siga igual al código.

### 3.2 Lógica (`application/client-service.ts`, nuevo)

- `find({ email, identificacion })`: necesita al menos uno (si no, `400`). Busca `usu_correo = lower(email) OR usu_documento = upper(identificacion)`.
  0 filas → `404 CLIENT_NOT_FOUND`; 2 usuarios distintos → `409 CLIENT_DATA_CONFLICT`; 1 → el cliente.
- `ensure({ nombre, email, identificacion, telefono })`: valida (correo, teléfono E.164 o `09XXXXXXXX`, identificación, nombre de dos palabras).
  Si `find` encuentra al cliente lo devuelve (`creado: false`). Si no, inserta el `usuario` (`usu_origen = 'BOOKING'`, sin contraseña, `usu_verificado = false`) y le asigna el rol `CLIENTE` (`creado: true`).
  Si dos peticiones lo crean a la vez, la segunda choca con el `UNIQUE` (`23505`): se vuelve a leer y se devuelve el existente.
- En los dos casos llama a `billing.ensurePrincipal` (sección 3.4). Si esa llamada falla, responde `502`, pero el usuario ya quedó creado: el siguiente `POST` lo encuentra y completa los datos de facturación.
- `auth-service`: el login rechaza una cuenta sin contraseña con el mismo `401` genérico de credenciales inválidas. El registro web con un correo de una cuenta `BOOKING` responde `409 ACCOUNT_EXISTS_USE_RECOVERY`.
- `user-repository`: `findByEmailOrDocument`, `createBookingClient`.

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

Las dos rutas públicas se registran en `apps/partner-api/src/routes.ts` con su handler `handlers/clients.ts`.

Permisos: solo un socio con `X-API-Key` o un `ADMIN`. En `apps/gateway/src/authentication.ts` se agregan `clients:read` y `clients:write` a `PARTNER_SCOPES`, y la Partner API exige esos scopes en las dos rutas.

### 3.4 Datos de facturación (`ms-billing-profile`)

Ruta interna nueva `billing.ensurePrincipal`: `POST /internal/usuarios/:usuId/datos-facturacion/principal`.

- Si el usuario no tiene un `dato_facturacion` activo con esa identificación, lo crea: `dfa_tipo_identificacion` = `CEDULA` o `PASAPORTE`, `dfa_razon_social` = nombre, `dfa_correo`, `dfa_telefono`. Si no tiene otro principal, lo marca `dfa_es_principal = true`.
- Si ya existe, no cambia nada. Así es idempotente y la puede llamar Identity cada vez.

## 4. Reserva enlazada al cliente (`ms-booking`)

- Migración `1796000001200-ReservaCliente.ts`: `ALTER TABLE reserva ADD COLUMN usu_id BIGINT;` (ID lógico de Identity; `NULL` en las reservas anteriores) más su índice.
- `input.ts`: acepta `customer.client_id` (opcional).
- `PurchaseFlow.purchase`, antes de crear la orden:
  - si llega `client_id`, se comprueba con `identity.findClient` que coincide con el correo o el documento del titular (si no, `422 CLIENT_MISMATCH`);
  - si no llega, se llama a `identity.ensureClient` con los datos del titular.

  Así, aunque Booking no llame antes a `/clientes`, el turista nunca se duplica. En una compra web, `usu_id` es el usuario de la sesión.
- `reservation-mapper`: la respuesta de la reserva incluye `client_id`, un campo extra del contrato que no rompe a quien no lo lea.
- `remote.ts`: métodos `findClient` y `ensureClient`.

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

- `CheckinService.checkIn`: en la misma transacción que pasa la reserva a `CHECKED_IN`, si la reserva vino de Booking (decisión 11), inserta el aviso con este cuerpo:

  ```json
  {
    "external_order_id": "<ord_numero>",
    "client_id": "<usu_id>",
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
- `CheckinService.assertStaff`: además de `ADMIN`, `OPERADOR` y socio, acepta el rol `GUIA` (decisión 8).

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
- En la lista de reservas del admin se agrega la columna "Aviso a Booking".
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

1. `ms-identity`: migración, `client-service`, rutas, rol `GUIA`, cambios de login y registro. Actualizar el SQL de `Plan/`.
2. `ms-billing-profile`: `ensurePrincipal`.
3. `esb`: rutas de identity y billing nuevas, destino `booking_core`, `auth: 'partner-api-key'`.
4. `gateway` y `partner-api`: scopes y rutas `/clientes`.
5. `ms-booking`: migración, enlace reserva ↔ cliente, aviso y reintentos, rol `GUIA`.
6. `booking-mock`: receptor del check-in.
7. Web: `AdminCheckinPage`, API y columna de aviso.
8. Variables de entorno y workflow.

### Guion de demostración

1. **Punto 1.** Admin web → "Nueva atracción" → crear un turno con 10 cupos. Booking reserva 2 → en "Disponibilidad" el turno muestra 8.
2. **Punto 2, cliente.** Booking llama `GET /clientes?email=…` (404) y luego `POST /clientes` (201, `client_id`). Un segundo `POST` con los mismos datos responde 200 con el mismo `client_id`. Booking reserva con ese `client_id` y la reserva lo devuelve.
3. **Punto 2, check-in.** El guía entra a `/admin/checkin`, escanea el QR, escribe la cédula y confirma. La reserva queda `CHECKED_IN`, el aviso pasa a `ENVIADA` y Booking responde `{"acknowledged": true}`. En local se ve en `booking-mock /received`.
