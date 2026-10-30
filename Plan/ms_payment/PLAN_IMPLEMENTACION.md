# Plan de implementación · ms_payment (Payment Service, REST)

| | |
|---|---|
| Microservicio | 12 · Payment Service |
| Protocolo | REST (detrás del ESB) y webhooks de las pasarelas |
| Clasificación (arquitectura_esb_v3) | Asíncrono: publica `PagoAprobado` y `PagoRechazado` al bus. |
| Contrato | [ms_payment-openapi.yaml](ms_payment-openapi.yaml) |
| Contrato externo de referencia | `Plan/PlanBooking/atracciones-openapi-v3(1).yaml` (`CreateReservaRequestV3.payment_method.method`) |
| Base de datos | [ms_payment.sql](ms_payment.sql) → base `ms_payment` |
| Ref. externas | `ord_id` (Order) |
| Puerto local propuesto | `PORT=4020` |

## 1. Objetivo

Programar el servicio dueño de los pagos: registra el cobro de una orden, obtiene el resultado de una **pasarela simulada**, guarda
los datos no sensibles de tarjetas y transferencias, y avisa del resultado por eventos. Es un proyecto académico: no se usan pasarelas
reales.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 12 de `02_microservicios_v2_bases_de_datos.sql` | `metodo_pago`, `estado`, `pago`, `pago_tarjeta`, `pago_transferencia`. Una orden tiene a lo sumo un pago aprobado. Nunca se guarda el número de la tarjeta |
| `arquitectura_esb_v3.html` | Webhook: Payment responde 202 y encola (medida 8). `PagoAprobado` y `PagoRechazado` llegan a Order, Booking e Invoicing. Refund consulta el monto cobrado |
| Contrato v3 | `payment_method.method`: `CREDIT_CARD`, `DEBIT_CARD`, `PAYPAL`, `TRANSFER`. Es el único dato de pago que envía Booking Prototipo |

### Cambios al script general

| Cambio | Motivo |
|---|---|
| Tabla `outbox` | La arquitectura exige publicar `PagoAprobado` y `PagoRechazado` |

El resto es la sección 12 sin cambios, incluidos los 4 métodos y los 4 estados.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Quién registra el pago.** El diagrama muestra el webhook y los eventos, pero ninguna flecha hacia Payment para iniciar el cobro.
   Order llama a `POST /pagos` por el ESB, porque `orden` guarda el método de pago.
2. **Canal B2B.** El contrato solo envía `method`, sin datos de tarjeta, y Booking Prototipo cobra al turista: con `canal = B2B`
   el pago queda `APROBADO` de inmediato, sin pasarela y sin fila en `pago_tarjeta`.
3. **Pasarela simulada.** Es la única pasarela: atiende `CREDIT_CARD`, `DEBIT_CARD` y `PAYPAL`, y confirma por el webhook,
   como lo haría una pasarela. Queda detrás de una interfaz, por si se reemplaza por una API o un microservicio de simulación más completo.
4. **Resultado de la simulación.** Se aprueba siempre, salvo con `ultimos4 = 0000`, que simula un rechazo. Sirve para probar
   las dos ramas de la saga. `PAYPAL` siempre se aprueba.
5. **Idempotencia.** La tabla no tiene una columna para esto: `pag_numero` lo genera Order (`PAG-<ord_numero>-<intento>`),
   así un reintento repite el mismo número. Un nuevo intento tras un rechazo usa otro número.
6. **Compensación de la saga.** No existe el estado `ANULADO`: un pago `PENDIENTE` pasa a `FALLIDO`; uno `APROBADO` se devuelve
   siempre con Refund.
7. **Orden sin cobro.** `pag_monto` debe ser mayor que 0: si un cupón deja el total en 0, Order no crea pago.
8. **Moneda.** No se guarda, como indica el script general. Order la envía en `POST /pagos` solo para la pasarela.
9. **Transferencias.** El cliente envía el comprobante y un `ADMIN` lo aprueba o rechaza. La orden queda en espera hasta
   entonces.
10. **Cola del webhook.** Se publica en una cola del bus. Si no se puede publicar, responde `503` y la pasarela reintenta. No
    se agrega una tabla de webhooks.
11. **Firma del webhook.** HMAC-SHA256 con el secreto `WEBHOOK_SECRET`, en la cabecera `X-Signature`, para que nadie más
    pueda aprobar pagos llamando a esa ruta.

## 4. Estructura del servicio (`apps/services/ms-payment`)

```
apps/services/ms-payment/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP, consumidor de webhooks y publicador del outbox
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      payment-service.ts             registro, cancelación y resultado del cobro
      webhook-processor.ts           mensajes de la cola -> resultado del pago
      transfer-service.ts            comprobante y verificación
      input.ts                       validación
    integration/
      gateways/
        gateway.ts                   interfaz de pasarela
        simulated-gateway.ts         pasarela simulada
      esb-routes.ts                  rutas para registrar en el ESB
      payment-client.ts              cliente para los demás componentes
    persistence/
      data-source.ts
      payment-repository.ts
      migrations/
        index.ts
        <timestamp>-PaymentSchema.ts        DDL y datos iniciales de ms_payment.sql
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-payment.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL completo de `ms_payment.sql`.
- [ ] `PaymentRepository`: crear, buscar por ID, número y orden, listar, y aplicar el resultado.
  - `23505` en `pag_numero` → devolver el pago guardado.
  - `23505` en `ux_pago_orden_aprobado` → `409 PAYMENT_ALREADY_APPROVED`.

### Fase 2 · Registro y consulta
- [ ] **`POST /pagos`:**
  - `B2B`: `APROBADO` y evento en la misma transacción.
  - `WEB`: `PENDIENTE`, guarda `pago_tarjeta` si aplica y pide el cobro a la pasarela después de confirmar la transacción.
  - Tarjeta sin datos en `WEB` → `422`.
- [ ] **`POST /pagos/{id}/cancelacion`:** según la decisión 6.
- [ ] `GET /pagos`, `/pagos/{id}`, `/pagos/orden/{ord_id}` y `/metodos-pago`.
- [ ] `/health` con `NodeHealthResponse`.

### Fase 3 · Webhooks
- [ ] **`POST /webhooks/simulada`:** valida la firma, encola y responde `202` sin esperar el procesamiento.
- [ ] Consumidor: busca por `pag_numero`.
  - Aprobado: `pag_aprobado_en`, `pag_referencia`, `pag_autorizacion` y evento `PagoAprobado`.
  - Rechazado: `pag_rechazado_en`, `pag_motivo_rechazo` y evento `PagoRechazado`.
  - Un pago en estado final no cambia: un webhook repetido se ignora.
- [ ] Pasarela simulada: tras confirmar el registro, envía el resultado a su webhook según la decisión 4, con `pag_referencia` y
      `pag_autorizacion` generados.

### Fase 4 · Transferencias
- [ ] `POST /pagos/{id}/transferencia`: solo para `TRANSFER` y `PENDIENTE`.
- [ ] `PUT /pagos/{id}/verificacion`: rol `ADMIN`; publica el evento.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `payment.*`. Los webhooks entran por el API Gateway.
- [ ] **Order:** registrar el pago y consumir los eventos.
- [ ] **Booking:** consumir los eventos. Invoicing no los consume: emite con `OrdenPagada`.
- [ ] **Refund:** consultar el monto con `GET /pagos/{id}`. Su plan debe ajustarse a este contrato.

## 6. Criterios de aceptación

- `payment_method.method` del contrato v3 se guarda como `mpa_codigo`, sin traducirlo.
- Una orden nunca tiene dos pagos aprobados.
- Repetir `POST /pagos` con el mismo `numero` no crea otro pago.
- Un webhook responde `202` sin esperar el procesamiento, y repetirlo no cambia el resultado.
- Ningún número de tarjeta ni CVV se guarda ni se escribe en logs.
- Todo pago aprobado o rechazado produce un solo evento.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Webhook falso | Firma HMAC |
| Webhook perdido | Si la cola no acepta, `503`, y la pasarela simulada reintenta |
| Resultado que llega después de cancelar la orden | El pago ya en `FALLIDO` no cambia y el webhook tardío se registra en el log |
| Pago aprobado en dos intentos | `ux_pago_orden_aprobado` rechaza el segundo; se registra para devolverlo con Refund |
