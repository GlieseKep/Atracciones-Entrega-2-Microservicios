# Plan de implementación · ms_audit (Audit Service, REST + consumidor de eventos)

| | |
|---|---|
| Microservicio | 16 · Audit Service |
| Protocolo | Consumidor de eventos del bus; REST de consulta |
| Clasificación (arquitectura_esb_v3) | Consumidor: guarda todos los eventos en la bitácora con su `correlation_id`. |
| Contrato | [ms_audit-openapi.yaml](ms_audit-openapi.yaml) |
| Base de datos | [ms_audit.sql](ms_audit.sql) → base `ms_audit` |
| Ref. externas | `usu_id` (Identity) |
| Puerto local propuesto | `PORT=4022` |

## 1. Objetivo

Programar la bitácora del sistema: un servicio que escucha todos los eventos del bus, los guarda y permite consultarlos, por ejemplo
para seguir una compra completa por su `correlation_id`.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 16 de `02_microservicios_v2_bases_de_datos.sql` | Tabla `bitacora` con `bit_correlation_id` (`X-Correlation-Id`) |
| `arquitectura_esb_v3.html` | Audit consume todos los eventos del bus. Cada microservicio escribe el `correlation_id` |

El contrato v3 no incluye la bitácora.

### Cambios al script general

| Cambio | Motivo |
|---|---|
| `bit_event_id UUID UNIQUE` | El bus puede entregar un evento dos veces, y sin esta columna quedaría repetido |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Columnas.** `bit_accion` = tipo del evento (`PagoAprobado`); `bit_entidad` = servicio de origen (`payment`);
   `bit_entidad_id` = agregado; `bit_detalle` = payload.
2. **Eventos desconocidos.** se guarda cualquier evento, sin una lista de tipos permitidos, para que un servicio nuevo no
   obligue a cambiar Audit.
3. **`usu_id`.** se llena si el evento lo trae; si no, queda en `NULL`.
4. **`bit_ip`.** Los eventos no traen la IP. queda en `NULL`.
5. **`bit_creado_en`.** guarda la fecha del evento, no la de su registro, para que la bitácora quede en orden real.
6. **Evento que no se puede guardar.** se reintenta; un mensaje mal formado se registra en el log y se descarta, para no
   bloquear la cola.
7. **Retención.** no se borra nada, por tratarse de una bitácora.

## 4. Estructura del servicio (`apps/services/ms-audit`)

```
apps/services/ms-audit/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP y consumidor de eventos
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      event-recorder.ts              evento -> fila de la bitácora
      input.ts                       filtros y paginación
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      audit-client.ts                cliente para los demás componentes
    persistence/
      data-source.ts
      audit-repository.ts
      migrations/
        index.ts
        <timestamp>-AuditSchema.ts          DDL de ms_audit.sql
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-audit.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL completo de `ms_audit.sql`.
- [ ] `AuditRepository`: `record` con `ON CONFLICT (bit_event_id) DO NOTHING`, `list` con filtros, y `actions`.

### Fase 2 · Consumidor
- [ ] Cola `audit`, suscrita a todas las claves del bus.
- [ ] Registrar cada evento según la decisión 1.

### Fase 3 · API REST
- [ ] `GET /bitacora` y `GET /bitacora/acciones`: solo rol `ADMIN`.
- [ ] `/health` con `NodeHealthResponse`.

### Fase 4 · Integración
- [ ] **ESB:** registrar las rutas `audit.*`.
- [ ] **Todos los servicios:** los eventos deben llevar `event_id` y `correlation_id`.
- [ ] **GraphQL:** bitácora en el panel.

## 6. Criterios de aceptación

- Todo evento del bus queda en la bitácora, aunque sea de un tipo nuevo.
- Un evento repetido queda una sola vez.
- Una compra se puede seguir de principio a fin por su `correlation_id`.
- Solo un `ADMIN` puede consultar la bitácora.
- Audit no tiene rutas de escritura.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Audit caído | El bus conserva los eventos en su cola hasta que vuelva |
| Bitácora muy grande | Consultas paginadas e índices por fecha, entidad y `correlation_id` |
| Datos personales en `bit_detalle` | Los eventos llevan datos minimizados, como pide el contrato para `payload`; nunca datos de tarjeta |
