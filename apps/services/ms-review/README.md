# ms-review · Review Service (REST)

Reseñas de atracciones en escala de 1 a 10, moderación y promedios para Catalog.

- Contrato: [`Plan/ms_review/ms_review-openapi.yaml`](../../../Plan/ms_review/ms_review-openapi.yaml)
- Base de datos: `ms_review` ([`Plan/ms_review/ms_review.sql`](../../../Plan/ms_review/ms_review.sql); migración en `src/persistence/migrations`)
- Plan: [`Plan/ms_review/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_review/PLAN_IMPLEMENTACION.md)

## Reglas

- Cualquier usuario autenticado puede reseñar, una vez por atracción.
- Las reseñas anónimas no piden sesión y quedan ocultas hasta que un `ADMIN` las apruebe.
- El autor edita su reseña, pero no la borra. Una reseña oculta sigue oculta al editarla.
- Solo `ADMIN` aprueba u oculta.
- El autor se muestra como `Nombre A.`, sin correo. Si Identity falla, como `Viajero`.

## Eventos

Publica `review.RESENA_PUBLICADA` por el outbox cada vez que cambian los promedios de una atracción: crear, editar, aprobar u ocultar. Trae `atr_id`, `ren_id`, `promedio`, los cuatro pilares y `numero_resenas`, solo de reseñas visibles. `score` es el promedio de `ren_puntuacion`, a 2 decimales.

## Comunicación con otros servicios

- **Rutas del ESB:** `MS_REVIEW_ROUTES` (`src/integration/esb-routes.ts`).
- **Cliente:** `ReviewClient` (`src/integration/review-client.ts`).
- **Llama por el ESB a:** `catalog.getReference`, con caché de 5 minutos, e `identity.getUsers`.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-review
INTERNAL_TOKEN_SECRET=... ESB_URL=... RABBITMQ_URL=... node apps/services/ms-review/dist/main.js
```
