# ms-audit · Audit Service

Guarda todos los eventos del bus en una bitácora y permite consultarlos, por ejemplo para seguir una compra por su `correlation_id`.

- Contrato: [`Plan/ms_audit/ms_audit-openapi.yaml`](../../../Plan/ms_audit/ms_audit-openapi.yaml)
- Base de datos: `ms_audit` ([`Plan/ms_audit/ms_audit.sql`](../../../Plan/ms_audit/ms_audit.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_audit/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_audit/PLAN_IMPLEMENTACION.md)

## Reglas

- **Columnas:** `bit_accion` es el tipo del evento, `bit_entidad` el servicio de origen, `bit_entidad_id` el agregado y `bit_detalle` el payload.
- Se guarda cualquier evento, sin una lista de tipos permitidos.
- `usu_id` se llena si el evento lo trae. `bit_ip` queda en `NULL`, porque los eventos no traen la IP.
- `bit_creado_en` es la fecha del evento, no la de su registro.
- Un evento repetido queda una sola vez, por `bit_event_id`.
- Un error de la base se reintenta. Un evento mal formado se registra en el log y se descarta.
- Sin rutas de escritura, y no se borra nada. Consultar la bitácora exige el rol `ADMIN`.
- `desde` y `hasta` son días completos en hora de Ecuador.

## Eventos

- **Consume:** todos (`#`), en la cola `ms-audit`. `audit` es la cola del servicio viejo.
- **Publica:** ninguno.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_AUDIT_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `AuditClient` (`src/integration/audit-client.ts`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-audit
INTERNAL_TOKEN_SECRET=... RABBITMQ_URL=... node apps/services/ms-audit/dist/main.js
```
