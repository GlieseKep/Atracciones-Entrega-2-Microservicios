# Plan de implementación · ms_support (Support Service, REST)

| | |
|---|---|
| Microservicio | 15 · Support Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Sin referencias externas. |
| Contrato | [ms_support-openapi.yaml](ms_support-openapi.yaml) |
| Base de datos | [ms_support.sql](ms_support.sql) → base `ms_support` |
| Puerto local propuesto | `PORT=4017` |

## 1. Objetivo

Programar el servicio que recibe los mensajes de contacto de los visitantes, para que un administrador los lea.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 15 de `02_microservicios_v2_bases_de_datos.sql` | `mensaje_contacto`: nombre, correo, asunto, cuerpo y `men_leido` |
| `arquitectura_esb_v3.html` | "Sin referencias externas. Mensajes de contacto de los visitantes." Sin eventos |

El contrato v3 no incluye este servicio. `ms_support.sql` es la sección 15 del script general, sin cambios.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Asunto.** `men_asunto` admite 30 caracteres, y un asunto escrito a mano no cabría bien. El portal ofrece una lista corta
   (`Reserva`, `Pago`, `Factura`, `Cuenta`, `Otro`), y el servicio solo valida la longitud. Así se agregan temas sin cambiar el servicio.
2. **Responder al visitante.** El script no guarda respuestas. El administrador responde desde su correo, y el sistema solo
   marca `leido`.
3. **Envíos repetidos.** No hay columna de IP. El límite de peticiones va en el API Gateway, no en el servicio.
4. **Permisos.** Enviar es público, sin sesión. Listar y marcar son solo para `ADMIN`.
5. **Conservación.** Los mensajes no se borran, ni por API.

## 4. Estructura del servicio (`apps/services/ms-support`)

```
apps/services/ms-support/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      message-input.ts               validación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      support-client.ts              cliente para los demás componentes
    persistence/
      data-source.ts
      message-repository.ts
      migrations/
        index.ts
        <timestamp>-SupportSchema.ts  DDL de ms_support.sql
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-support.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL de `ms_support.sql`.
- [ ] `MessageRepository`: crear, listar con filtro `leido` y cambiar `men_leido`.

### Fase 2 · API REST
- [ ] `POST /mensajes-contacto`: público; el texto se recorta y no se acepta vacío.
- [ ] `GET /mensajes-contacto` y `PUT /mensajes-contacto/{id}/leido`, solo `ADMIN`.
- [ ] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Integración
- [ ] **ESB:** registrar las rutas `support.*`.
- [ ] **API Gateway:** límite de peticiones en el formulario público.
- [ ] **GraphQL:** formulario del portal y bandeja del panel.

## 6. Criterios de aceptación

- Un visitante sin sesión puede enviar un mensaje, pero no leer ninguno.
- Un correo inválido o un texto vacío o demasiado largo responde `400`.
- Con `leido=false`, la lista muestra solo los pendientes.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Spam en el formulario público | Límite en el API Gateway |
| Correos personales en la base | Solo `ADMIN` los lee |
