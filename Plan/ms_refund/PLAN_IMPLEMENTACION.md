# Plan de implementación · ms_refund (Refund Service, REST)

| | |
|---|---|
| Microservicio | 13 · Refund Service |
| Protocolo | REST (detrás del ESB) |
| Clasificación (arquitectura_esb_v3) | Asíncrono: publica `ReembolsoEmitido` al bus. |
| Contrato | [ms_refund-openapi.yaml](ms_refund-openapi.yaml) |
| Base de datos | [ms_refund.sql](ms_refund.sql) → base `ms_refund` |
| Ref. externas | `pag_id` (Payment) |
| Eventos | Publica `ReembolsoEmitido` |
| Puerto local propuesto | `PORT=4016` |

## 1. Objetivo

Programar el servicio dueño de los reembolsos: devuelve lo cobrado por una orden sin superar el monto pagado, y avisa a los demás servicios.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 13 de `02_microservicios_v2_bases_de_datos.sql` | `reembolso`; `rem_numero` es el `reembolso_id` (`REF-ATR-7F3K9Q`). El servicio consulta a Payment el monto antes de procesar |
| `arquitectura_esb_v3.html` | Refund consulta a Payment por REST. `ReembolsoEmitido` llega a Order y Booking |
| Contrato v3 | `reembolso_id` y `monto_reembolsado` en la respuesta de la cancelación, con reembolso del 100 % |
| Planes de Booking, Order e Invoicing | Booking pide el reembolso y necesita la respuesta al momento. Order e Invoicing consumen el evento, con `ord_id` y `monto` |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| `rem_clave_idempotencia` | Sin ella, un reintento de la cancelación devolvería el dinero dos veces |
| Tabla `outbox` | La arquitectura exige publicar `ReembolsoEmitido` |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **Entrada por orden.** `POST /reembolsos` recibe `ord_id`, que Booking ya conoce, y Refund busca el pago aprobado con
   `GET /pagos/orden/{ord_id}`. La tabla guarda solo `pag_id`, como dice el script, y el evento lleva `ord_id`.
2. **Reembolso síncrono.** La pasarela es simulada. Se procesa en la misma petición: `rem_procesado_en` se llena al crear la fila,
   y `rem_referencia` es `SIM-` más el `rem_numero`. No hace falta una columna de estado, y no hay reembolsos fallidos.
3. **Monto.** Sin `monto` se devuelve todo el saldo, que es lo que usa Booking porque el contrato dice 100 %. `ADMIN` puede enviar
   un monto parcial. Superar el saldo responde `409 REFUND_EXCEEDS_BALANCE`.
4. **Reembolsos parciales acumulados.** Dos parciales pueden sumar el total, y el plan de Order solo miraba el monto de cada evento.
   El evento también lleva `monto_acumulado`, y Order pasa a `REEMBOLSADA` cuando este iguala `ord_total`. Invoicing lo usa igual
   para anular la factura.
5. **Orden sin pago aprobado.** Una reserva `PENDING` o una orden de total 0 no tienen qué devolver. Refund responde
   `409 NO_APPROVED_PAYMENT`, y Booking sigue la cancelación con `CancelOrder`, sin reembolso.
6. **Clave de idempotencia.** Booking usa `res_uuid`, porque una reserva se cancela una sola vez. La misma clave con otros datos
   responde `409 IDEMPOTENCY_KEY_REUSED`.
7. **Concurrencia.** Cada reembolso toma un bloqueo por `pag_id` mientras suma el saldo.
8. **Permisos.** `X-Service-Token` para Booking, y `ADMIN` para todas las rutas. El cliente ve su reembolso en la reserva.
9. **Payment no responde.** `503 PAYMENT_UNAVAILABLE`, sin crear nada. Nunca se reembolsa sin conocer el monto cobrado.

## 4. Estructura del servicio (`apps/services/ms-refund`)

```
apps/services/ms-refund/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP y publicador del outbox
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      refund-input.ts                validación
      refund-service.ts              saldo y emisión
    events/
      outbox-publisher.ts
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      refund-client.ts               cliente para los demás componentes
      payment-client.ts
    persistence/
      data-source.ts
      refund-repository.ts
      migrations/
        index.ts
        <timestamp>-RefundSchema.ts  DDL de ms_refund.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 3 programadas en `apps/services/ms-refund`; compila y el contrato pasa Spectral sin errores. Sin pruebas. Falta la Fase 4, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-refund.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL de `ms_refund.sql`.
- [x] `RefundRepository`: suma del saldo, creación con outbox en una transacción, búsqueda por clave y por número, y lista.
  - `23505` en `rem_clave_idempotencia` → se devuelve el reembolso existente.

### Fase 2 · API REST
- [x] `POST /reembolsos`:
  1. Busca la clave; si existe, responde el mismo reembolso.
  2. Pide a Payment el pago `APROBADO` de la orden.
  3. Con bloqueo por `pag_id`, calcula el saldo, valida el monto y crea la fila y `ReembolsoEmitido`.
- [x] `GET /reembolsos` y `GET /reembolsos/{numero}`.
- [x] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Eventos
- [x] Publicador del outbox hacia RabbitMQ.
- [x] `ReembolsoEmitido` con `reembolso_id`, `pag_id`, `ord_id`, `monto` y `monto_acumulado`.

### Fase 4 · Integración
- [ ] **ESB:** registrar las rutas `refund.*`.
- [ ] **Booking:** pedir el reembolso al cancelar.
- [ ] **Order, Booking, Invoicing, Audit:** consumir `ReembolsoEmitido`.
- [ ] **GraphQL:** reembolsos en el panel.

## 6. Criterios de aceptación

- Ni con peticiones simultáneas se devuelve más de lo cobrado.
- Reintentar con la misma clave no crea otro reembolso.
- Un reembolso total deja la orden en `REEMBOLSADA`, aunque venga de varios parciales.
- Cada reembolso emite un solo `ReembolsoEmitido`.
- Cancelar una reserva sin pago aprobado no crea reembolso.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Payment caído | La cancelación responde error y se puede reintentar con la misma clave |
| Refund emite y Booking falla antes de guardar | El reintento usa `res_uuid` y recibe el mismo reembolso |
| Evento perdido | El outbox lo publica en la misma transacción, y se reintenta hasta confirmarlo |
