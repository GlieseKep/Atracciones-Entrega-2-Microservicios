# Plan de implementación · ms_catalog (Catalog & Attractions Service, REST)

| | |
|---|---|
| Microservicio | 4 · Catalog & Attractions Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Consume `RESENA_PUBLICADA` y `TARIFA_ACTUALIZADA`. |
| Contrato | [ms_catalog-openapi.yaml](ms_catalog-openapi.yaml) |
| Contrato externo de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` (`/atracciones`, `/search`, `/{id}`, `/categorias`, `/categorias/arbol`) |
| Base de datos | [ms_catalog.sql](ms_catalog.sql) → base `ms_catalog` |
| Ref. externas | `ciu_id`, `prov_id` (Location); `usu_id` (Identity) |
| Puerto local propuesto | `PORT=4019` |

## 1. Objetivo

Programar el servicio dueño de la información turística: operadores, guías, categorías, idiomas, inclusiones y atracciones con
sus fotos e itinerario. Expone las rutas públicas de catálogo del contrato v3 y la administración de esos datos.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 4 de `02_microservicios_v2_bases_de_datos.sql` | Tablas, vista `v_atraccion_completa`, idiomas y categorías iniciales. Los promedios de calificación se guardan en `atraccion` |
| `arquitectura_esb_v3.html` | Booking Prototipo consulta Catalog por REST. Booking obtiene de Catalog el guía asignado y el punto de encuentro. `RESENA_PUBLICADA` actualiza las calificaciones y `TARIFA_ACTUALIZADA` el precio |
| Contrato v3 | Las cinco rutas públicas, sus respuestas y `POPULARITY`, `PRICE_*`, `RATING_DESC` como orden |

### Cambios al script general, todos exigidos por el contrato

| Cambio | Motivo en el contrato |
|---|---|
| `atr_codigo CHAR(12)` | `id` es alfanumérico (`PRhu4UBTWPBC`); `uuid` es otro campo, que sale de `atr_uuid` |
| `cat_codigo` | `CategoryTreeNode.id` es texto (`cat-tours-201`) |
| `ope_codigo` pasa de `INTEGER` a texto | `ProveedorInfo.id` es `proveedor-atracciones-dilan` |
| `atr_precio_adulto`, `_nino`, `_senior`, `_infante`, `_estudiante` | `price` es obligatorio; `precio_min` y `precio_max` filtran |

`id`, `padre_id` y `proveedor.id` siempre salen de estos códigos, nunca de `atr_id`, `cat_id` ni `ope_id`.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Largo de `atr_codigo`.** El contrato solo muestra un ejemplo de 12 caracteres. Son 12 alfanuméricos, generados por el
   servicio. No cambia nunca.
2. **Precios.** La tarjeta exige la tabla completa, pero la arquitectura no tiene llamada de Catalog a Pricing, solo el evento.
   `TARIFA_ACTUALIZADA` trae la tabla vigente y Catalog la guarda en `atr_precio_*`. El plan de Pricing debe incluirlo.
3. **Atracción sin tarifa.** `price` es obligatorio: solo se puede publicar con tarifa cargada; una en `BORRADOR` no sale
   en las rutas públicas.
4. **Nombre de la ciudad.** `city` es texto y Catalog guarda `ciu_id`. El script general indica resolverlo por API. Se piden
   las ciudades en lote a Location por el ESB, con caché en memoria de 10 minutos.
5. **Filtro `ciudad`.** Location convierte el nombre en uno o varios `ciu_id` (una provincia como Galápagos devuelve todas sus
   ciudades) y se filtra por ellos. Si no existe, la respuesta es `200` con `data` vacío.
6. **Orden `POPULARITY`.** El diseño no tiene columna de popularidad. Se ordena por `atr_numero_resenas` y luego por
   `atr_calificacion_promedio`.
7. **Filtros `fecha_inicio` y `fecha_fin`.** Dependen de los turnos de Inventory, y la arquitectura no tiene esa llamada. Por eso
   Catalog pide a Inventory por el ESB qué atracciones del resultado tienen cupos en esas fechas.
8. **`adult_count`.** El contrato no dice qué hace en la búsqueda. Se valida y no se aplica.
9. **Permisos.** `ADMIN` administra todo. `OPERADOR` solo las atracciones y guías del operador al que está vinculado en
   `operador_usuario`. Los usuarios de ese rol no pueden crear operadores.
10. **Eventos sin deduplicación.** Traen valores absolutos, así que repetir uno no cambia el resultado. Un evento viejo que llegue
    tarde se corrige con el siguiente. No se agregan tablas para esto.

## 4. Estructura del servicio (`apps/services/ms-catalog`)

```
apps/services/ms-catalog/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP y consumidores de eventos
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      search.ts                      filtros, orden y paginación
      attraction-mapper.ts           filas -> AtraccionCardResponseV2 y AtraccionDetailResponseV2
      attraction-input.ts            validación de atracciones
      admin-input.ts                 validación de operadores, guías y categorías
      permissions.ts                 ADMIN u OPERADOR de su operador
      locations.ts                   ciudades de Location en lote, con caché
      availability.ts                filtro de fechas (decisión 7)
      event-handlers.ts              RESENA_PUBLICADA y TARIFA_ACTUALIZADA
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      catalog-client.ts              cliente para los demás componentes
    persistence/
      data-source.ts
      attraction-repository.ts
      category-repository.ts
      operator-repository.ts
      guide-repository.ts
      inclusion-repository.ts
      migrations/
        index.ts
        <timestamp>-CatalogSchema.ts        DDL y datos iniciales de ms_catalog.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 4 programadas en `apps/services/ms-catalog`; compila y el contrato pasa Spectral sin errores (55 avisos). Sin pruebas. Falta la Fase 5, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-catalog.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL completo de `ms_catalog.sql`: dominios, triggers, vista, idiomas y categorías.
- [x] `AttractionRepository`: búsqueda paginada, ficha por `atr_codigo`, `atr_slug` o `atr_uuid`, alta y edición.
  - Solo `atr_estado = 'PUBLICADA'` y `atr_eliminado_en IS NULL` salen en rutas públicas.
  - Texto con `ix_atraccion_busqueda` (trigramas).
  - `23505` en `atr_slug` → `409 ATTRACTION_SLUG_EXISTS`.
- [x] `CategoryRepository`: árbol con `cat_padre_id`, lista plana filtrada por `padre_id`, alta y edición.
- [x] `OperatorRepository` (con `operador_usuario`), `GuideRepository` e `InclusionRepository`.

### Fase 2 · API pública (contrato v3)
- [x] **`GET /atracciones/categorias/arbol`** y **`GET /atracciones/categorias`:** solo categorías activas, por `cat_orden`.
- [x] **`POST /atracciones/search`** y **`GET /atracciones`:** todos los filtros del contrato; `limit` máximo 50; `sort` con
      `POPULARITY` por defecto.
- [x] **`GET /atracciones/{id}`:** acepta código, slug o UUID; `404` si no está publicada.
- [x] El mapeo entrega cada campo con su alias en inglés y en español, como exige el contrato.
- [x] `duration` en texto (`"8 horas"`), `time` del itinerario como `"09:00 a.m."`, y `badge_text` a partir de `score`.
- [x] `google_maps_url` se arma con `atr_latitud` y `atr_longitud`.
- [x] `inclusions_list` y `exclusions_list` desde `inclusion`, tipos `INCLUYE` y `NO_INCLUYE`.
- [x] Respuestas de error exactas del contrato: `400`, `404`, `500`.

### Fase 3 · Administración
- [x] `/guias`, `/operadores`, `/categorias`, `/idiomas`, `/inclusiones` y `/admin/atracciones/**`, con los permisos de la decisión 9.
- [x] Alta de atracción: nace en `BORRADOR`; `atr_codigo` y slug los genera el servicio.
- [x] `ciu_id` y `prov_id` se validan contra Location; `usu_id` contra Identity.
- [x] Publicar exige categoría, foto y tarifa (`422 ATTRACTION_NOT_PUBLISHABLE`).
- [x] `slug` no puede ser `search`, `categorias`, `reservas`, `promociones`, `eventos` ni `health`, porque chocaría con otras
      rutas del contrato.
- [x] `GET /internal/atracciones/{id}/logistica`: punto de encuentro, política de cancelación y guía de la reserva, para Booking.
- [x] `GET /internal/atracciones/{id}/referencia`: convierte el ID público o slug en `atr_id`, para Review.
- [x] `/health` con `NodeHealthResponse`.

### Fase 4 · Eventos
- [x] **`RESENA_PUBLICADA`:** actualiza `atr_calificacion_promedio`, los cuatro pilares y `atr_numero_resenas`.
- [x] **`TARIFA_ACTUALIZADA`:** actualiza `atr_precio_*` y `atr_moneda`, buscando por `atr_codigo`.
- [x] Un evento de una atracción desconocida se registra en el log y se descarta.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `catalog.*`.
- [ ] **API Gateway / Partner API:** exponer las cinco rutas públicas.
- [ ] **GraphQL:** catálogo y administración por el ESB.

## 6. Criterios de aceptación

- Las cinco rutas públicas cumplen el contrato v3: mismos campos, alias y códigos HTTP.
- `id` nunca expone `atr_id`, y la ruta `/atracciones/{id}` acepta código, slug o UUID.
- Una atracción sin publicar o eliminada no aparece en ninguna ruta pública.
- Una reseña o un cambio de tarifa se refleja en el catálogo sin que Catalog recalcule nada.
- Un `OPERADOR` no puede modificar atracciones de otro operador.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Location no responde al armar `city` | La caché mantiene los nombres ya conocidos |
| Precio desactualizado si se pierde un evento | El siguiente `TARIFA_ACTUALIZADA` lo corrige; Order siempre cotiza con Pricing |
| Búsqueda lenta con muchos filtros | Índices de `ms_catalog.sql` y trigramas; `limit` máximo 50 |
