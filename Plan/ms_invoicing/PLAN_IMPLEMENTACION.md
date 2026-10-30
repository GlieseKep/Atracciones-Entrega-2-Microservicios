# Plan de implementación · ms_invoicing (Electronic Invoicing Service, SOAP)

| | |
|---|---|
| Microservicio | 14 · Electronic Invoicing Service |
| Protocolo | SOAP hacia el SRI (por el ESB), eventos de entrada y REST de consulta |
| Clasificación (arquitectura_esb_v3) | Asíncrono: publica `FacturaAutorizada`. El SRI responde lento. |
| Contrato | [ms_invoicing-openapi.yaml](ms_invoicing-openapi.yaml) |
| Base de datos | [ms_invoicing.sql](ms_invoicing.sql) → base `ms_invoicing` |
| Ref. externas | `ord_id`, `det_id` (Order); `dfa_id` (Billing Profile) |
| Puerto local propuesto | `PORT=4021` |

## 1. Objetivo

Programar el servicio dueño de las facturas electrónicas: emite la factura cuando una orden queda pagada, guarda los datos del
comprador en ese momento, la envía a autorizar al SRI desde una cola y avisa cuando queda autorizada.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 14 de `02_microservicios_v2_bases_de_datos.sql` | `estado`, `factura`, `factura_detalle`. Una factura por orden, y cada línea de orden se factura una sola vez. El comprador se guarda como copia al emitir |
| Regla de compra de la sección 10 | Invoicing emite la factura **únicamente** al recibir `OrdenPagada` |
| `arquitectura_esb_v3.html` | Invoicing lee Billing Profile y las líneas de Order. Autoriza con el SRI por SOAP y XML firmado. Facturas en cola, con reintento exponencial (medida 9) |
| Decisión de Order | Las tarifas ya incluyen IVA: `ord_iva = 0`, e Invoicing separa el IVA en la factura |

El contrato v3 no incluye facturación.

### Cambios al script general

| Cambio | Motivo |
|---|---|
| `fac_estado_sri`, `fac_intentos`, `fac_proximo_intento_en`, `fac_mensaje_sri` | La arquitectura exige cola y reintentos, y el script no guarda si el SRI autorizó, rechazó o sigue pendiente |
| Secuencia `seq_factura_secuencial` | Numeración de `fac_numero` |
| Tabla `outbox` | La arquitectura exige publicar `FacturaAutorizada` |

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño no define estos puntos.

1. **SRI simulado.** Como es un proyecto académico, un SRI simulado que expone SOAP y responde `AUTORIZADO`, con la URL en
   `SRI_URL`. El XML se arma con el formato del SRI, y la firma se simula porque la real exige un certificado digital.
2. **Desglose del IVA.** Con `IVA_PORCENTAJE = 15`, `fde_precio_unitario` = precio de la orden / 1,15, redondeado a 2
   decimales; `fde_iva` = total de la línea − `fde_subtotal`. Así `fac_total` es **exactamente** `ord_total`, sin diferencias de centavos.
3. **Descuento del cupón.** `ord_descuento` se reparte entre las líneas en proporción a su valor; la diferencia de centavos va
   a la última.
4. **Evento de entrada.** La tabla de la arquitectura dice que `PagoAprobado` llega a Invoicing, pero la regla del script dice que se
   factura únicamente con `OrdenPagada`. seguir el script, porque es más específico.
5. **Comprador.** `orden` no guarda un perfil de facturación. con `usu_id`, se usa el perfil principal de Billing Profile.
   Sin perfil, o en una orden B2B, la factura sale a `CONSUMIDOR_FINAL` (`9999999999999`, correo `FACTURA_CORREO_DEFECTO`).
6. **Reembolsos.** La arquitectura no envía `ReembolsoEmitido` a Invoicing ni tiene nota de crédito. Invoicing también consume
   ese evento: cuando `monto_acumulado` iguala el total, la factura pasa a `ANULADA`; antes no cambia. Sin notas de crédito.
7. **Estado.** la factura nace en `PAGADA`, porque solo se emite con la orden pagada. `NO_PAGADA` queda en la tabla sin usarse.
8. **Rechazo del SRI.** tras 5 intentos fallidos por error técnico, o ante un rechazo del SRI, pasa a `RECHAZADA` con
   `fac_mensaje_sri`. La compra no se revierte, y un `ADMIN` la revisa.
9. **Numeración.** `001-001-` más el secuencial de 9 dígitos. `fac_clave_acceso` se calcula con la regla del SRI (49 dígitos
   y dígito verificador módulo 11).
10. **XML.** no se guarda, porque se puede volver a generar con los datos de la factura.

## 4. Estructura del servicio (`apps/services/ms-invoicing`)

```
apps/services/ms-invoicing/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          HTTP, consumidores, cola del SRI y publicador del outbox
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      invoice-service.ts             emisión a partir de OrdenPagada
      tax.ts                         desglose del IVA y reparto del descuento
      buyer.ts                       comprador: Billing Profile o consumidor final
      access-key.ts                  clave de acceso del SRI
      invoice-xml.ts                 XML del comprobante
      sri-queue.ts                   envío con reintento exponencial
      refund-events.ts               ReembolsoEmitido
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      invoicing-client.ts            cliente para los demás componentes
    persistence/
      data-source.ts
      invoice-repository.ts
      migrations/
        index.ts
        <timestamp>-InvoicingSchema.ts      DDL y estados de ms_invoicing.sql
apps/sri-simulado/                   SRI simulado con SOAP (decisión 1)
```

## 5. Fases

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [ ] Copiar el contrato a `packages/contracts/openapi/ms-invoicing.yaml` y lintarlo con Spectral.
- [ ] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [ ] Migración con el DDL completo de `ms_invoicing.sql`.
- [ ] `InvoiceRepository`: crear factura y detalle en una transacción, consultar y actualizar el estado del SRI.
  - `23505` en `uq_factura_orden` → el evento ya se procesó y se ignora.
- [ ] Toma de la cola con `FOR UPDATE SKIP LOCKED`, para que varios workers no envíen la misma factura.

### Fase 2 · Emisión
- [ ] Consumidor de `OrdenPagada`:
  1. Lee la orden y sus líneas con `GetOrder`.
  2. Obtiene el comprador.
  3. Calcula el desglose con `tax.ts`.
  4. Genera número y clave de acceso, y guarda la factura en `PAGADA` y `PENDIENTE`.

### Fase 3 · SRI
- [ ] Worker con ritmo controlado, por `SRI_MAX_POR_MINUTO`.
- [ ] Envía por el ESB `validarComprobante` y `autorizacionComprobante`.
- [ ] Reintento exponencial con `fac_proximo_intento_en`: 1, 2, 4, 8 y 16 minutos.
- [ ] Autorizada: `fac_autorizacion_sri`, `AUTORIZADA` y `FacturaAutorizada` en la misma transacción.
- [ ] SRI simulado.

### Fase 4 · Consulta y reembolsos
- [ ] `GET /facturas`, `/facturas/{id}` y `/facturas/orden/{ord_id}`.
- [ ] Consumidor de `ReembolsoEmitido`, según la decisión 6.
- [ ] `/health` con `NodeHealthResponse`.

### Fase 5 · Integración
- [ ] **ESB:** registrar las rutas `invoicing.*` y las operaciones SOAP del SRI.
- [ ] **Order:** `GetOrder` y `OrdenPagada`.
- [ ] **Billing Profile:** debe ofrecer el perfil principal de un usuario; se agrega cuando se rehaga su plan.
- [ ] **Refund:** `ReembolsoEmitido` debe incluir `ord_id` y `monto_acumulado`.
- [ ] **GraphQL:** factura de una orden y listado del panel.

## 6. Criterios de aceptación

- Solo una orden pagada genera factura, y a lo sumo una.
- `fac_total` es exactamente `ord_total`, y `fac_total = fac_subtotal - fac_descuento + fac_iva`.
- Cambiar un perfil de facturación no altera una factura emitida.
- La compra no espera al SRI.
- Un SRI lento o caído deja las facturas en cola, y se envían al recuperarse.
- Un evento repetido no crea otra factura.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| SRI lento | Cola con ritmo controlado; la compra no depende de él |
| Dos workers envían la misma factura | `FOR UPDATE SKIP LOCKED` |
| Diferencias de centavos por el IVA | `fde_iva` se calcula por diferencia (decisión 2) |
| Factura rechazada | Queda `RECHAZADA` con su mensaje para que un `ADMIN` la revise |
