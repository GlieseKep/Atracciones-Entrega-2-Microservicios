# Plan de implementación · ms_billing_profile (Billing Profile Service, REST)

| | |
|---|---|
| Microservicio | 2 · Billing Profile Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. |
| Contrato | [ms_billing_profile-openapi.yaml](ms_billing_profile-openapi.yaml) |
| Base de datos | [ms_billing_profile.sql](ms_billing_profile.sql) → base `ms_billing_profile` |
| Ref. externas | `usu_id` (Identity) |
| Puerto local propuesto | `PORT=4013` |

## 1. Objetivo

Programar el servicio dueño de los datos de facturación: cada usuario administra sus perfiles y elige uno principal, que Invoicing
usa como comprador de la factura.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 2 de `02_microservicios_v2_bases_de_datos.sql` | `dato_facturacion`: tipos `CEDULA`, `RUC`, `PASAPORTE`, `CONSUMIDOR_FINAL`; varios perfiles por usuario, uno principal; borrado lógico |
| `arquitectura_esb_v3.html` | Referencia a `usuario`. Invoicing lee aquí los datos de facturación |

El contrato v3 no incluye este servicio. `ms_billing_profile.sql` es la sección 2 del script general, sin cambios.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Primer perfil.** El primero del usuario queda como principal automáticamente.
2. **Quitar el principal.** Al desactivarlo deja de ser principal, y el activo más reciente pasa a serlo. Así, un usuario con
   perfiles activos siempre tiene un principal.
3. **Perfil desactivado con el mismo documento.** `uq_dato_facturacion_usuario_identificacion` impediría crearlo otra vez. Crear de nuevo reactiva el perfil con los datos nuevos.
4. **Validación del documento.** Además de la regla del script, cédula con dígito verificador módulo 10, como pide el
   contrato para `document_id`, y pasaporte en mayúsculas.
5. **`CONSUMIDOR_FINAL`.** Se permite como perfil; si no se envía el número, se completa con `9999999999999`.
6. **Perfil de otro usuario.** Responde `404`, para no revelar que existe.
7. **Concurrencia.** Las operaciones de un usuario se hacen de una en una, con un bloqueo por usuario.

## 4. Estructura del servicio (`apps/services/ms-billing-profile`)

```
apps/services/ms-billing-profile/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      profile-input.ts               validación por tipo de identificación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      billing-profile-client.ts      cliente para los demás componentes
    persistence/
      data-source.ts
      profile-repository.ts
      migrations/
        index.ts
        <timestamp>-BillingProfileSchema.ts  DDL de ms_billing_profile.sql
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-billing-profile.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL de `ms_billing_profile.sql`.
- [ ] `ProfileRepository`: listar, crear, reemplazar, desactivar y marcar como principal, en transacciones con bloqueo por usuario.
  - `usu_id` sale siempre del token, nunca del cuerpo.
  - `23505` en la clave única → `409 BILLING_PROFILE_EXISTS`.
  - Al cambiar el principal, primero se desmarca el anterior, por `ux_dato_facturacion_principal`.

### Fase 2 · API REST
- [ ] `/usuarios/me/datos-facturacion`, `/{id}` y `/{id}/principal`, para el usuario autenticado.
- [ ] `GET /internal/usuarios/{usu_id}/datos-facturacion/principal`, con `X-Service-Token`.
- [ ] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Integración
- [ ] **ESB:** registrar las rutas `billing.*`.
- [ ] **Invoicing:** leer el perfil principal; con `404` factura a `CONSUMIDOR_FINAL`.
- [ ] **GraphQL:** perfiles de facturación en el portal.

## 6. Criterios de aceptación

- Un usuario no puede leer ni modificar el perfil de otro.
- Un usuario con perfiles activos tiene exactamente uno principal.
- Desactivar un perfil no borra la fila, y no cambia facturas ya emitidas.
- Un documento inválido para su tipo responde `400`.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Dos peticiones simultáneas dejan dos principales | `ux_dato_facturacion_principal` y el bloqueo por usuario |
| Usuario desactivado en Identity con perfiles activos | No afecta: solo se leen al facturar una orden suya |
