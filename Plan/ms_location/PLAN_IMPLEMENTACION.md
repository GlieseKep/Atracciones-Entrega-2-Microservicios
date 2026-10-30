# Plan de implementación · ms_location (Location Service, REST)

| | |
|---|---|
| Microservicio | 3 · Location Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Catálogo de solo lectura. Sin referencias externas. |
| Contrato | [ms_location-openapi.yaml](ms_location-openapi.yaml) |
| Base de datos | [ms_location.sql](ms_location.sql) → base `ms_location` |
| Puerto local propuesto | `PORT=4014` |

## 1. Objetivo

Programar el catálogo geográfico de Ecuador: regiones, provincias y ciudades, para que los demás servicios lo consulten.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 3 de `02_microservicios_v2_bases_de_datos.sql` | `region`, `provincia`, `ciudad` y su carga inicial |
| `arquitectura_esb_v3.html` | "Sin referencias externas. Catálogo de solo lectura que consultan otros servicios." Lo usan Catalog (`ciudad`, `provincia`) y Coupon (destinos) |
| Contrato v3 | `city` y `destinos_habilitados` son nombres, con ejemplos Quito, Baños, Cuenca y Galápagos |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| Ciudad `Baños` en Tungurahua | El contrato la usa como ejemplo de ciudad y de destino, y no está en la carga inicial |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Código de Baños.** `ciu_codigo` es obligatorio. `180250`, a confirmar con la tabla oficial.
2. **Galápagos.** El contrato la usa como destino, pero en el script es una provincia. Un nombre de provincia en la resolución
   devuelve todas sus ciudades.
3. **Solo lectura.** Sin rutas de escritura ni eventos, como dice la arquitectura. Agregar o desactivar una ciudad se hace
   con una migración.
4. **Búsqueda sin tildes.** Son pocas filas. El servicio las carga en memoria y compara sin tildes ni mayúsculas; no hace
   falta una extensión de PostgreSQL ni cambiar el esquema.
5. **Rutas internas.** `/internal/ciudades/lote` y `/internal/ciudades/resolucion` usan `X-Service-Token`, como en Identity. Las
   consultas `GET` son públicas.

## 4. Estructura del servicio (`apps/services/ms-location`)

```
apps/services/ms-location/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      geography.ts                   árbol, búsqueda y resolución en memoria
      input.ts                       validación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      location-client.ts             cliente para los demás componentes
    persistence/
      data-source.ts
      location-repository.ts
      migrations/
        index.ts
        <timestamp>-LocationSchema.ts       DDL y carga inicial de ms_location.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 2 programadas en `apps/services/ms-location`; compila. Sin pruebas. Falta la Fase 3, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-location.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL y la carga inicial de `ms_location.sql`.
- [x] `LocationRepository`: leer regiones, provincias y ciudades.

### Fase 2 · API REST
- [x] `GET /regiones`, `/provincias`, `/provincias/{id}`, `/ciudades` y `/ciudades/{id}`.
- [x] Las listas solo muestran lo activo; las rutas por ID también responden inactivos, para datos históricos.
- [x] `POST /internal/ciudades/lote`: los IDs que no existen se omiten.
- [x] `POST /internal/ciudades/resolucion`: según las decisiones 2 y 4.
- [x] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Integración
- [ ] **ESB:** registrar las rutas `location.*`.
- [ ] **Catalog:** nombres de ciudad, filtro por ciudad y validación de `ciu_id` y `prov_id`.
- [ ] **Coupon:** `destinos_habilitados`.
- [ ] **GraphQL:** listas de ciudades del portal y del panel.

## 6. Criterios de aceptación

- `banos`, `BAÑOS` y `Baños` encuentran la misma ciudad.
- `Galápagos` devuelve las ciudades de esa provincia.
- Ninguna otra base tiene FK hacia estas tablas.
- El servicio no tiene rutas de escritura.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Location caído | Catalog y Coupon guardan los nombres en caché |
| Falta una ciudad | Se agrega con una migración, y queda disponible al reiniciar el servicio |
