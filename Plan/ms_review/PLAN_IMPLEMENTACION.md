# Plan de implementación · ms_review (Review Service, REST)

| | |
|---|---|
| Microservicio | 5 · Review Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Publica `RESENA_PUBLICADA`. |
| Contrato | [ms_review-openapi.yaml](ms_review-openapi.yaml) |
| Base de datos | [ms_review.sql](ms_review.sql) → base `ms_review` |
| Ref. externas | `atr_id` (Catalog), `usu_id` (Identity) |
| Eventos | Publica `RESENA_PUBLICADA` |
| Puerto local propuesto | `PORT=4015` |

## 1. Objetivo

Programar el servicio dueño de las reseñas: recibirlas, moderarlas y avisar a Catalog los promedios de cada atracción.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 5 de `02_microservicios_v2_bases_de_datos.sql` | `resena`: escala de 1 a 10, cuatro pilares, una reseña por usuario y atracción, reseñas anónimas con `ren_autor_nombre`, y `ren_visible` |
| `arquitectura_esb_v3.html` | Referencias a `atraccion` y `usuario`. `RESENA_PUBLICADA` actualiza las calificaciones de Catalog |
| Contrato v3 | No tiene rutas de reseñas. `score`, `review_count` y `breakdown` salen de Catalog, y el `id` de una atracción es alfanumérico |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| Tabla `outbox` | La arquitectura exige publicar `RESENA_PUBLICADA` |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Quién puede reseñar.** La arquitectura no conecta Review con Booking. Cualquier usuario autenticado puede reseñar, sin
   comprobar que compró. Comprobarlo agregaría una llamada que no está en el diseño, y una columna para enlazar la reserva.
2. **Reseñas anónimas.** El script las permite. Se reciben sin sesión y quedan ocultas (`ren_visible = FALSE`) hasta que un
   administrador las apruebe, porque no tienen límite de una por atracción.
3. **Moderación.** Solo `ADMIN` aprueba u oculta. `OPERADOR` no, para que nadie oculte las críticas de su propia atracción.
4. **Editar y borrar.** El usuario puede editar su reseña, pero no borrarla. Una reseña oculta sigue oculta al editarla: si no,
   editar saltaría la moderación. Los administradores ocultan en vez de borrar.
5. **Cuándo se publica `RESENA_PUBLICADA`.** Es el único evento del diseño. Se publica cada vez que cambian los promedios de la
   atracción (crear, editar, aprobar u ocultar), con los promedios y el total ya calculados solo sobre reseñas visibles. Si ya no quedan
   reseñas visibles, van en `0`.
6. **`score`.** Es el promedio de `ren_puntuacion`, que envía el usuario, y no el promedio de los pilares. Todos se redondean a
   2 decimales, como `dom_calificacion` en Catalog.
7. **ID de atracción en las rutas.** Review guarda `atr_id`, y el ID público es otro. Las rutas reciben el ID público o slug, y
   Review pide el `atr_id` a Catalog con la nueva ruta `GET /internal/atracciones/{id}/referencia`, con caché de 5 minutos. La ruta está
   en el plan y el contrato de Catalog.
8. **Nombre del autor.** Se piden los nombres a Identity con `/internal/usuarios/lote` y se muestra `Nombre A.`, sin correo. Si
   Identity falla, se muestra `Viajero`, y la lista sigue funcionando.

## 4. Estructura del servicio (`apps/services/ms-review`)

```
apps/services/ms-review/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP y publicador del outbox
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      review-input.ts                validación
      review-service.ts              casos de uso y promedios
    events/
      outbox-publisher.ts
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      catalog-client.ts              atr_id, con caché
      identity-client.ts             nombres de autores
    persistence/
      data-source.ts
      review-repository.ts
      migrations/
        index.ts
        <timestamp>-ReviewSchema.ts  DDL de ms_review.sql
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-review.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL de `ms_review.sql`.
- [ ] `ReviewRepository`: crear, editar, cambiar visibilidad, listar y calcular promedios.
  - Cada cambio que afecte los promedios bloquea por `atr_id`, recalcula y escribe el outbox en la misma transacción.
  - `23505` en `uq_resena_atraccion_usuario` → `409 REVIEW_ALREADY_EXISTS`.

### Fase 2 · API REST
- [ ] `GET` y `POST /atracciones/{id}/resenas`, y `POST /atracciones/{id}/resenas/anonimas`.
- [ ] `GET /usuarios/me/resenas` y `PUT /usuarios/me/resenas/{id}`; `usu_id` sale siempre del token.
- [ ] `GET /admin/resenas` y `PUT /admin/resenas/{id}/visibilidad`, solo `ADMIN`.
- [ ] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Eventos
- [ ] Publicador del outbox hacia RabbitMQ, en orden de `creado_en`.
- [ ] `RESENA_PUBLICADA` con `atr_id`, `ren_id`, `promedio`, los cuatro pilares y `numero_resenas`.

### Fase 4 · Integración
- [ ] **ESB:** registrar las rutas `review.*`.
- [ ] **Catalog:** consumir `RESENA_PUBLICADA` y ofrecer la ruta de referencia.
- [ ] **GraphQL:** reseñas en el portal y moderación en el panel.

## 6. Criterios de aceptación

- Un usuario solo tiene una reseña por atracción, y solo edita la suya.
- Una reseña oculta no sale en la lista pública ni cuenta en los promedios.
- Una reseña anónima no aparece hasta que se aprueba.
- Crear, editar, aprobar u ocultar deja los promedios correctos en Catalog.
- Una puntuación fuera de 1 a 10 responde `400`.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Eventos que llegan desordenados | El outbox publica en orden, y cada evento trae los totales completos: el siguiente corrige al anterior |
| Catalog caído | Los eventos esperan en el outbox o en la cola. Solo fallan las creaciones que no tengan el `atr_id` en caché |
| Reseñas falsas | Moderación, y límite de peticiones en el API Gateway para las anónimas |
