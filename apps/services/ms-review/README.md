# ms-review · Review Service (REST)

Reseñas de las atracciones y su resumen por atracción, según el diseño v2 de microservicios. Reemplaza a la tabla `resena` y a la vista materializada `v_atraccion_calificacion` de Catalog, con las que convive hasta el corte.

- Contrato: [`Plan/ms_review/ms_review-openapi.yaml`](../../../Plan/ms_review/ms_review-openapi.yaml)
- Base de datos: `ms_review` ([`Plan/ms_review/ms_review.sql`](../../../Plan/ms_review/ms_review.sql); migraciones en `src/persistence/migrations`)
- Plan: [`Plan/ms_review/PLAN_IMPLEMENTACION.md`](../../../Plan/ms_review/PLAN_IMPLEMENTACION.md)

## Reglas

- Solo reseña un usuario del portal con una reserva **propia** de esa atracción en estado `CHECKED_IN` o `COMPLETED`. Se verifica con `booking.getReservation` por el ESB; `reservation_id` puede ser el UUID o el PNR, y se guarda el UUID.
- Una reserva habilita una sola reseña y un usuario reseña una atracción una sola vez (`409 REVIEW_ALREADY_EXISTS`).
- Notas de 1 a 10 con un decimal como máximo (`score` y los cuatro pilares del contrato v3).
- El resumen (`atraccion_calificacion`) cuenta solo las reseñas visibles. Se recalcula en la misma transacción que la reseña, con la atracción bloqueada, y su `version` sube en cada cambio.
- La moderación oculta (con motivo obligatorio) o vuelve a mostrar; nunca borra.
- El autor se muestra abreviado ("María A."), con el nombre que da Identity. Si Identity no responde, "Viajero verificado".

## Comunicación con otros servicios

Todo pasa por el ESB (`POST /esb/review/{operacion}`).

- **Rutas del ESB:** `MS_REVIEW_ROUTES` (`src/integration/esb-routes.ts`), con la forma de `RestRoute` de `apps/esb/src/routes.ts`.
- **Cliente:** `ReviewClient` (`src/integration/review-client.ts`) para GraphQL y Catalog.
- **Salida:** `booking.getReservation` (con el principal del usuario) y `identity.getUsers` (con la cuenta de servicio `review`).
- **Eventos publicados:** `review.ResenaPublicada` (RESENA_PUBLICADA del diagrama), con el resumen completo (`attraction_id`, `score`, `review_count`, `breakdown`, `version`). Catalog debe ignorar los que tengan una `version` menor a la que ya guardó.

## Ejecutar

```
npm run build
npm run db:migrate -- ms-review
INTERNAL_TOKEN_SECRET=... ESB_URL=http://127.0.0.1:3300 node apps/services/ms-review/dist/main.js
```

| Variable | Por defecto | |
|---|---|---|
| `PORT` | `4015` | |
| `DATABASE_URL` | `postgres://postgres:tourgirls-local@localhost:5433/ms_review` | |
| `INTERNAL_TOKEN_SECRET` | (obligatorio, 32+ caracteres) | verifica el principal y firma la cuenta de servicio |
| `ESB_URL` | `http://127.0.0.1:3300` | Booking e Identity |
| `RABBITMQ_URL` | (sin valor: bus en memoria) | bus donde se publica `ResenaPublicada` |
| `BASE_PATH` | `/api/v3` | prefijo de las rutas del contrato |

## Migrar los datos actuales

```
node tools/migrate-reviews-to-review.mjs --dry-run
node tools/migrate-reviews-to-review.mjs   # copia las reseñas, calcula los resúmenes y deja un evento por atracción
```
