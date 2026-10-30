# ms-identity · Identity & Access Service (REST)

Cuentas de usuario, roles, sesiones, verificación del correo, recuperación de contraseña, clientes API y validación de credenciales para el API Gateway.

- Contrato: [`Plan/ms_identity/ms_identity-openapi.yaml`](../../../Plan/ms_identity/ms_identity-openapi.yaml)
- Base de datos: `ms_identity` ([`Plan/ms_identity/ms_identity.sql`](../../../Plan/ms_identity/ms_identity.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_identity/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_identity/PLAN_IMPLEMENTACION.md)

## Reglas

- JWT `HS256` de 15 minutos; refresh token de 7 días, de un solo uso.
- Verificación del correo: 24 horas. Recuperación: 1 hora.
- Contraseñas con bcrypt. Los refresh tokens, los tokens de verificación y las claves de API se guardan como SHA-256.
- Una sesión revocada o un usuario desactivado deja de ser aceptado aunque su JWT no haya vencido.
- En desarrollo, `LogMailer` escribe los enlaces en el log.

## Autenticación de las rutas

- Rutas de usuario: `Authorization: Bearer <JWT>`, o el principal interno que reenvía el Gateway. `POST /auth/logout` necesita el JWT, porque revoca la sesión de su `sid`.
- `/internal/**`: cabecera `X-Service-Token`.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_IDENTITY_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `IdentityClient` (`src/integration/identity-client.ts`).
- No publica ni consume eventos.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-identity
ADMIN_EMAIL=... ADMIN_PASSWORD=... node tools/create-admin.mjs
JWT_SECRET=... SERVICE_TOKEN=... INTERNAL_TOKEN_SECRET=... node apps/services/ms-identity/dist/main.js
```

Los tres secretos deben tener al menos 32 caracteres.
