# Plan · Registrar en la bitácora los cambios de usuarios y roles (ms-identity → ms-audit)

| | |
|---|---|
| Fecha | 2026-11-05 |
| Origen | `AUDITORIA_PANEL_ADMIN.md` §4.4 |
| Servicios | ms-identity (publica), ms-audit (ya consume), panel administrativo (consulta) |

> **Estado (2026-11-05): programado** (secciones 3.1, 3.2 y 3.3). ms-identity compila con `tsc`; falta desplegar y
> correr la comprobación de la sección 5. La parte del panel (3.4) llega con la migración del panel administrativo.
> Cambio respecto del plan: `USUARIO_DESACTIVADO` no lleva `sesiones_revocadas` (la revocación no devuelve cuántas
> sesiones cerró; siempre se revocan todas al desactivar).

## 1. Situación inicial

- **ms-audit ya guarda cualquier evento del bus.** Su cola `ms-audit` escucha `#` y `toRecord` no tiene lista de tipos.
  De cada evento toma `type` → `accion`, el último tramo de `source` → `entidad`, `subject` → `entidad_id`,
  `data.usu_id` → `usu_id` (quién actuó) y el `data` completo → `detalle`. No hay que cambiarlo.
- **ms-identity no publica eventos.** No tiene tabla `outbox` (ni en `Plan/02_microservicios_v2_bases_de_datos.sql` ni en
  `Plan/ms_identity/ms_identity.sql`), no arranca `OutboxRelay` y `UserService` escribe sin eventos.
- Lo único que queda hoy es `usuario_rol.asignado_por`. Al quitar un rol la fila se borra y no queda rastro.
- Ya está hecho: `removeRole` rechaza que un administrador se quite su propio `ADMIN` (409 `CANNOT_REMOVE_OWN_ADMIN`).

## 2. Eventos

Todos se publican con `source = /servicios/identity` (`entidad = identity` en la bitácora) y `subject = <usu_id afectado>`.
En `data`, `usu_id` es **quien hizo el cambio**, como pide `bitacora.usu_id`, y `usuario_id` es la cuenta afectada.

| `tipo_evento` | Cuándo | `data` |
|---|---|---|
| `ROL_ASIGNADO` | `identityAssignRole` con éxito | `{ usu_id, usuario_id, correo, rol }` |
| `ROL_REVOCADO` | `identityRemoveRole` con éxito | `{ usu_id, usuario_id, correo, rol }` |
| `USUARIO_DESACTIVADO` | `identitySetUserActive { activo: false }` | `{ usu_id, usuario_id, correo }` (sus sesiones se revocan en la misma transacción) |
| `USUARIO_REACTIVADO` | `identitySetUserActive { activo: true }` | `{ usu_id, usuario_id, correo }` |
| `ADMIN_INICIAL_CREADO` | `createFirstAdmin` (`tools/create-admin.mjs`) | `{ usu_id: null, usuario_id, correo }` |
| `CLIENTE_API_CREADO` / `CLIENTE_API_ACTIVADO` / `CLIENTE_API_DESACTIVADO` | Altas y cambios de socios (`X-API-Key`) | `{ usu_id, cla_id, codigo }`; **nunca** la `api_key` |

No se publican el login, el registro ni la renovación de token: son operaciones frecuentes, no cambios administrativos.
Las contraseñas, los hashes, los tokens y las API keys nunca van en `data`.

Una operación que no cambia nada (por ejemplo, `ROLE_ALREADY_ASSIGNED`, `ROLE_NOT_ASSIGNED` o `CANNOT_REMOVE_OWN_ADMIN`)
falla antes de escribir y no genera evento.

## 3. Cambios

### 3.1 Base de datos (diseño y migración)

1. Añadir la tabla `outbox` de ms_identity en `Plan/02_microservicios_v2_bases_de_datos.sql` y en
   `Plan/ms_identity/ms_identity.sql`, con las mismas columnas que los demás servicios (`id`, `event_id` único,
   `tipo_evento`, `agregado_id`, `payload` JSONB, `correlation_id`, `creado_en`, `publicado_en`, `intentos`,
   `ultimo_error`) y el índice parcial `ix_outbox_pendientes`.
2. Migración nueva `apps/services/ms-identity/src/persistence/migrations/1796000000300-IdentityOutbox.ts`, registrada en
   `migrations/index.ts`.

### 3.2 ms-identity

1. **Repositorio:** `assignRole`, `removeRole` y `setActive` ya aceptan un `EntityManager`, o se les añade, para correr
   dentro de la transacción del evento.
2. **`UserService`**, todo en una transacción con `recordEvent` de `@atracciones/platform` (Transactional Outbox):
   - `assignRole(id, rol, adminId)`: insertar en `usuario_rol` + `ROL_ASIGNADO`.
   - `removeRole(id, rol, adminId)`: ya recibe `adminId`; borrar + `ROL_REVOCADO`.
   - `setActive(id, activo, adminId)`: actualizar, revocar sesiones (al desactivar) + `USUARIO_DESACTIVADO` / `USUARIO_REACTIVADO`.
   - `createFirstAdmin`: `ADMIN_INICIAL_CREADO`.
3. **`ApiClientService`:** `create` y `setActive` publican `CLIENTE_API_*` y necesitan recibir el `adminId` desde `app.ts`.
4. **`main.ts`:** `new OutboxRelay(dataSource, await createEventBus(process.env.RABBITMQ_URL), 'identity', { logger }).start()`,
   igual que ms-review. En la app única de Azure, `RABBITMQ_URL` ya está en la configuración.
5. **Contrato de ms-identity:** documentar los eventos en `Plan/ms_identity/PLAN_IMPLEMENTACION.md` (sección de eventos).
   El OpenAPI no cambia.

### 3.3 ms-audit

Sin cambios de código. Comprobar que `auditListActions` (`GET /bitacora/acciones`) devuelve los tipos nuevos en cuanto
llega el primer evento, porque las acciones salen de la propia tabla.

### 3.4 Panel administrativo

1. En el detalle de un usuario, pestaña **Historial**: `auditListEntries { entidad: 'identity', entidad_id: <id> }`,
   con lo que le hicieron a esa cuenta.
2. En Observabilidad › Bitácora: filtro `entidad = identity` y `usu_id` para ver lo que hizo un administrador.
3. Etiquetas: `ROL_ASIGNADO` → "Rol asignado", `ROL_REVOCADO` → "Rol quitado", `USUARIO_DESACTIVADO` → "Cuenta
   desactivada", `USUARIO_REACTIVADO` → "Cuenta reactivada", `ADMIN_INICIAL_CREADO` → "Primer administrador",
   `CLIENTE_API_*` → "Socio creado/activado/desactivado". Mostrar el rol y el correo de `detalle`.

## 4. Orden de trabajo

1. Diseño: tabla `outbox` en los dos SQL del plan.
2. Migración y repositorio de ms-identity.
3. Eventos en `UserService` y `ApiClientService`, y `adminId` en las rutas de clientes API.
4. Relay en `main.ts`.
5. Compilar con `tsc` (ms-identity) y desplegar.
6. Panel: pestaña Historial y filtros de la bitácora (dentro de la reprogramación del panel).

## 5. Comprobación tras desplegar

1. Desde el panel (o GraphQL), dar `GUIA` a un usuario de prueba y quitárselo.
2. En `ms_identity`: `SELECT tipo_evento, publicado_en FROM outbox ORDER BY creado_en DESC LIMIT 5;` → dos filas con
   `publicado_en` lleno.
3. GraphQL `auditListEntries { entidad: "identity" }` → `ROL_ASIGNADO` y `ROL_REVOCADO`, con `usu_id` del administrador y
   `entidad_id` del usuario afectado.
4. Intentar quitarse el propio `ADMIN` → 409 `CANNOT_REMOVE_OWN_ADMIN` y **ningún** evento nuevo.
