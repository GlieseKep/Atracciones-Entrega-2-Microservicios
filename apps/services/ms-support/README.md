# ms-support · Support Service (REST)

Mensajes del formulario de contacto del portal y su seguimiento por el equipo de soporte, según el diseño v2 de microservicios. Reemplaza a la tabla `mensaje_contacto` y a las rutas `/mensajes-contacto` de Audit, con las que convive hasta el corte.

- Contrato: [`Plan/ms_support/ms_support-openapi.yaml`](../../../Plan/ms_support/ms_support-openapi.yaml)
- Base de datos: `ms_support` ([`Plan/ms_support/ms_support.sql`](../../../Plan/ms_support/ms_support.sql); migraciones en `src/persistence/migrations`)
- Plan: [`Plan/ms_support/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_support/PLAN_IMPLEMENTACION.md)

## Reglas

- Rutas, campos y estados iguales a los de Audit (`NUEVO → EN_PROCESO → RESPONDIDO → CERRADO`), para que GraphQL solo cambie de servicio. El `id` pasa de UUID a número (como texto).
- `POST /mensajes-contacto` es público; con sesión se guarda también el usuario. Validación igual que en Audit, salvo el nombre, que ahora llega hasta 120 caracteres.
- Máximo 5 mensajes por correo en una hora (`SUPPORT_MAX_MESSAGES_PER_HOUR`): el siguiente responde `429 TOO_MANY_REQUESTS` con `Retry-After`. Los envíos del mismo correo se serializan para que dos simultáneos no pasen los dos. El límite por IP lo aplica el API Gateway: la IP del cliente no llega a los servicios (`men_ip` queda vacía).
- `respondido_en` se fija la primera vez que el mensaje pasa a `RESPONDIDO` o `CERRADO` y se borra si vuelve a `NUEVO` o `EN_PROCESO`.
- La bandeja (`GET /mensajes-contacto`, `/resumen` y `PUT /{id}/estado`) es solo para el administrador.

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/support/{operacion}`).

- **Rutas del ESB:** `MS_SUPPORT_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `RestRoute` de `apps/esb/src/routes.ts`. Reemplazan a `audit.sendContactMessage`, `audit.listContactMessages` y `audit.setContactMessageStatus`.
- **Cliente:** `SupportClient` (`src/integration/support-client.ts`) para GraphQL.
- No publica ni consume eventos.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-support
INTERNAL_TOKEN_SECRET=... node apps/services/ms-support/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4017` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_support` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal que firma el Gateway |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |
| `SUPPORT_MAX_MESSAGES_PER_HOUR` | `5` | mensajes por correo en una hora |

## Migrar los datos actuales

```
node tools/migrate-contact-to-support.mjs --dry-run
node tools/migrate-contact-to-support.mjs   # copia y compara la cantidad por estado; se puede repetir después del corte
```
