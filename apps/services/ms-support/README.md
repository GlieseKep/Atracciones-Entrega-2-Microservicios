# ms-support · Support Service (REST)

Mensajes de contacto de los visitantes. Sin referencias externas ni eventos.

- Contrato: [`Plan/ms_support/ms_support-openapi.yaml`](../../../Plan/ms_support/ms_support-openapi.yaml)
- Base de datos: `ms_support` ([`Plan/ms_support/ms_support.sql`](../../../Plan/ms_support/ms_support.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_support/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_support/PLAN_IMPLEMENTACION.md)

## Reglas

- Enviar es público, sin sesión. Listar y marcar como leído son solo para `ADMIN`.
- El portal ofrece una lista corta de asuntos; el servicio solo valida la longitud.
- El administrador responde desde su correo: el sistema solo marca `leido`.
- Los mensajes no se borran.
- El límite de envíos va en el API Gateway.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_SUPPORT_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `SupportClient` (`src/integration/support-client.ts`).

## Ejecutar

```
npm run build
npm run db:migrate -- ms-support
INTERNAL_TOKEN_SECRET=... node apps/services/ms-support/dist/main.js
```
