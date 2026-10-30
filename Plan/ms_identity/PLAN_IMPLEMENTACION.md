# Plan de implementación · ms_identity (Identity & Access Service, REST)

| | |
|---|---|
| Microservicio | 1 · Identity & Access Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Sin referencias externas. |
| Contrato | [ms_identity-openapi.yaml](ms_identity-openapi.yaml) |
| Contrato externo de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` (`BearerAuth`, `ApiKeyAuth`, `ProblemDetails`, `NodeHealthResponse`) |
| Base de datos | [ms_identity.sql](ms_identity.sql) → base `ms_identity` |
| Puerto local propuesto | `PORT=4018` |

## 1. Objetivo

Programar el servicio dueño de las identidades del sistema:

- cuentas de usuario, con sus roles `ADMIN`, `OPERADOR` y `CLIENTE`;
- inicio de sesión con JWT (RFC 7519) y sesiones revocables;
- verificación del correo y recuperación de contraseña;
- clientes API para el canal máquina a máquina (`X-API-Key` de Booking Prototipo);
- validación de esas dos credenciales para el API Gateway.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 1 de `02_microservicios_v2_bases_de_datos.sql` | Tablas `rol`, `usuario`, `usuario_rol`, `sesion`, `token_verificacion`, `cliente_api`; vista `v_usuario_roles`; roles iniciales |
| `arquitectura_esb_v3.html` | El API Gateway valida el JWT o la `X-API-Key` (`cliente_api`) contra Identity por REST. `cliente_api` guarda el hash de la clave. Identity no publica eventos y no tiene referencias externas |
| Contrato v3 | Las rutas protegidas aceptan `BearerAuth` o `ApiKeyAuth`. Errores 401 y 403 en RFC 7807, prefijo `/api/v3`, salud con `NodeHealthResponse` |

`ms_identity.sql` es la sección 1 del script general, sin cambios.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos. `usu_id` y `cla_id` son `BIGINT`, como en el script general: el contrato v3 no expone IDs de usuario.

1. **Firma del JWT.** El contrato solo exige RFC 7519. Se usa `HS256` con un secreto que solo tiene Identity, porque el Gateway
   valida llamando a Identity.
2. **Vigencias.** JWT 15 minutos, refresh token 7 días, verificación de correo 24 horas, recuperación 1 hora.
3. **Envío de correos.** La arquitectura no tiene un servicio de notificaciones, pero `token_verificacion` necesita entregar enlaces.
   Se usa una interfaz `Mailer` dentro de Identity, con una implementación de desarrollo que escribe el enlace en el log.
4. **Correo verificado.** No se exige para iniciar sesión; se exigirá después, si alguna operación lo necesita.
5. **Primer administrador.** El script general no crea ninguno. Lo crea un comando de una sola ejecución, con
   `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
6. **Autenticación de las rutas `/internal/**`.** Cabecera `X-Service-Token` con un secreto compartido por los componentes
   internos.
7. **Permisos de un cliente API.** `cliente_api` no tiene roles. La clave identifica a un socio, y cada servicio decide
   qué rutas acepta para un `CLIENTE_API`; el contrato ya indica que `PUT /atracciones/promociones/contrato` puede responder 403 a quien no sea
   administrador o socio autorizado.

## 4. Estructura del servicio (`apps/services/ms-identity`)

```
apps/services/ms-identity/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      auth-service.ts                registro, login, refresh, logout
      verification-service.ts        verificación del correo y recuperación
      user-service.ts                perfil, usuarios y roles
      api-client-service.ts          clientes API y generación de claves
      credential-validator.ts        validación del JWT y de la X-API-Key
      passwords.ts                   bcrypt
      tokens.ts                      JWT, refresh tokens y SHA-256
      mailer.ts                      interfaz Mailer (decisión 3)
      input.ts                       validación de entradas
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      identity-client.ts             cliente para los demás componentes
    persistence/
      data-source.ts
      user-repository.ts
      session-repository.ts
      token-repository.ts
      api-client-repository.ts
      migrations/
        index.ts
        <timestamp>-IdentitySchema.ts       DDL e inserción de roles de ms_identity.sql
tools/create-admin.mjs                     primer administrador (decisión 5)
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 4 programadas en `apps/services/ms-identity`; compila y el contrato pasa Spectral sin errores (36 avisos). Sin pruebas. Falta la Fase 5, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-identity.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL completo de `ms_identity.sql`: dominios, trigger, vista y roles iniciales.
- [x] `UserRepository`: alta, búsqueda por ID y correo, perfil, activo, listado paginado, lote.
  - El correo se guarda en minúsculas, porque `usu_correo` distingue mayúsculas.
  - `23505` en `usu_correo` → `409 EMAIL_ALREADY_EXISTS`; en `usu_documento` → `409 DOCUMENT_ALREADY_EXISTS`.
- [x] Roles: asignar y quitar en `usuario_rol`; los roles del usuario se leen de `v_usuario_roles`.
- [x] `SessionRepository`: crear, buscar por hash, revocar una, revocar todas las de un usuario.
- [x] `TokenRepository`: crear, consumir (`tokv_usado`) e invalidar los anteriores del mismo tipo.
- [x] `ApiClientRepository`: crear, listar, activar y buscar por hash.

### Fase 2 · Autenticación
- [x] **Registro:** hash bcrypt, rol `CLIENTE` y token `EMAIL` en una sola transacción; el correo se envía al terminar.
- [x] **Login:** correo y contraseña incorrectos responden el mismo `401 INVALID_CREDENTIALS`; cuenta inactiva → `403 ACCOUNT_DISABLED`.
      Crea la sesión con IP y user agent, y actualiza `usu_ultimo_acceso`.
- [x] **JWT:** `sub` = `usu_id`, `sid` = `ses_id`, `roles`, `iat`, `exp`.
- [x] **Refresh:** en `ses_token_hash` va el SHA-256 de un valor aleatorio, nunca el valor. Revoca la sesión usada y crea otra.
- [x] **Logout:** revoca la sesión del `sid`.
- [x] **Verificación y recuperación:** `tokv_token` guarda el SHA-256 del valor enviado. Un token vencido o usado → `400 INVALID_TOKEN`.
      `POST /auth/recuperacion` responde `202` siempre.

### Fase 3 · API de usuarios y clientes
- [x] `/usuarios/me` y `/usuarios/me/password`.
- [x] `/usuarios/**` y `/roles`: solo rol `ADMIN`. `usr_asignado_por` es el administrador autenticado.
- [x] Desactivar un usuario revoca sus sesiones; un administrador no puede desactivarse a sí mismo (`409 CANNOT_DISABLE_SELF`).
- [x] `/clientes-api/**`: solo rol `ADMIN`. La clave se genera con 32 bytes aleatorios, se muestra una vez y se guarda su SHA-256.
- [x] `/health` con `NodeHealthResponse`.
- [x] Todos los errores en RFC 7807 con `code`, `correlation_id` y `timestamp`; `X-Correlation-Id` se propaga.

### Fase 4 · Validación para el Gateway
- [x] `POST /internal/tokens/validar`: firma, expiración, sesión no revocada y `usu_activo`.
- [x] `POST /internal/api-keys/validar`: SHA-256, `cla_activo`, y actualiza `cla_ultimo_uso`.
- [x] Ambas responden el mismo `Principal` (`USUARIO` o `CLIENTE_API`).
- [x] `POST /internal/usuarios/lote` para los servicios que guardan `usu_id`.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `identity.*`.
- [ ] **API Gateway:** validar `Authorization` y `X-API-Key` con Identity, responder 401 si no pasan y reenviar el `Principal`.
- [ ] **GraphQL:** registro, login, perfil y administración de usuarios por el ESB.

## 6. Criterios de aceptación

- Una ruta protegida del contrato v3 acepta un JWT válido o una `X-API-Key` activa, y responde 401 en RFC 7807 con cualquier otra.
- Ninguna contraseña, refresh token, token de verificación ni clave de API se guarda en claro.
- Una sesión revocada o un usuario desactivado deja de ser aceptado aunque su JWT no haya vencido.
- Un refresh token no se puede usar dos veces.
- Un cliente API desactivado deja de ser aceptado.
- `POST /auth/recuperacion` no revela si un correo existe.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Identity caído impide autenticar todo el sistema | Plazos cortos en el Gateway y varias instancias, ya que el servicio no guarda estado en memoria |
| Una consulta por cada petición validada | Índice único en `ses_token_hash` y `cla_clave_hash`, y caché breve en el Gateway si hace falta |
| Fuerza bruta en el login | Rate limiting por cliente en el API Gateway (medida 1 de la arquitectura) |
| Secreto del JWT expuesto | Solo lo tiene Identity; al rotarlo, las sesiones se renuevan con su refresh token |
