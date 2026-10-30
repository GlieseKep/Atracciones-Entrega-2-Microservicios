# Plan de implementación · ms_pricing (Pricing Service, gRPC)

| | |
|---|---|
| Microservicio | 6 · Pricing Service |
| Protocolo | gRPC sobre HTTP/2 (detrás del ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Publica `TARIFA_ACTUALIZADA`. |
| Contrato | [pricing.proto](pricing.proto) |
| Base de datos | [ms_pricing.sql](ms_pricing.sql) → base `ms_pricing` |
| Ref. externas | `atr_codigo` (Catalog) |
| Eventos | Publica `TARIFA_ACTUALIZADA` |
| Puerto local propuesto | `GRPC_PORT=50062` |

## 1. Objetivo

Programar el servicio dueño de las tarifas: guarda sus versiones por atracción y tipo de boleto, da a Order el precio de cada boleto y
avisa a Catalog la tabla vigente.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 6 de `02_microservicios_v2_bases_de_datos.sql` | Remite al script propio `ms_pricing.sql`: `tarifa` versionada, tipos `ADULT`, `CHILD`, `SENIOR`, `INFANT`, `STUDENT`, y `outbox` |
| `arquitectura_esb_v3.html` | Order pide por gRPC la tarifa vigente por tipo de boleto. `TARIFA_ACTUALIZADA` actualiza el precio de Catalog |
| Contrato v3 | `TarifaBaseDesglosada`: `adult`, `child`, `senior` e `infant` obligatorios, `student` opcional; infante a $0 |

`ms_pricing.sql` no cambia en sus tablas. Las tarifas incluyen IVA.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Fecha de la tarifa.** Vale la fecha de la actividad, no la de compra. `CreateOrder` no recibía esa fecha, por eso `order.proto`
   incluye `fecha`.
2. **Solo tablas completas.** El contrato exige cuatro tipos en cada tarjeta, y una tarifa suelta o cerrada podría dejar la atracción sin
   precio. La única escritura es `SetPriceTable`, sin `SetTariff` ni `CloseTariff`.
3. **Versiones.** Una tabla nueva rige desde `valid_from`, que no puede estar en el pasado, y cierra la anterior el día previo.
   Con la misma `valid_from` reemplaza los precios, lo que permite corregir un error; las órdenes no cambian porque congelan su precio. Si
   ya hay una versión posterior → `TARIFF_OVERLAP`.
4. **Evento al entrar en vigencia.** Una tarifa futura no genera ningún cambio el día que empieza, y Catalog quedaría con el precio viejo.
   Un proceso al arrancar y a las 00:05 publica `TARIFA_ACTUALIZADA` de las atracciones cuya tarifa empieza hoy. Cambiar una
   tabla futura no publica nada.
5. **Atracción desconocida.** Pricing no consulta a Catalog, como Inventory. Hay que cargar la tarifa antes de publicar la
   atracción, y Catalog descarta el evento de una atracción que no conoce.
6. **Infante y moneda.** `INFANT` siempre vale $0, como dice el contrato, y no se envía. La moneda es siempre `USD`.
7. **Permisos.** `ADMIN`, u `OPERADOR` de la atracción, como en Inventory. Para un `OPERADOR`, Pricing consulta `catalog.adminGetAttraction` con su principal: es la única llamada a
   Catalog, y solo decide el permiso.

## 4. Estructura del servicio (`apps/services/ms-pricing`)

```
apps/services/ms-pricing/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts                          gRPC, publicador del outbox y proceso diario
    app.ts                           implementación de PricingService
    contract.ts                      tipos del proto
    application/
      input.ts                       validación
      quote.ts                       QuoteTickets
      price-table.ts                 tabla vigente
    events/
      outbox-publisher.ts
      effective-tariffs-job.ts       tarifas que empiezan hoy
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      pricing-client.ts              cliente para los demás componentes
    persistence/
      data-source.ts
      pricing-repository.ts
      migrations/
        index.ts
        <timestamp>-PricingSchema.ts  DDL de ms_pricing.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 3 programadas en `apps/services/ms-pricing`; compila y el `.proto` carga. Sin pruebas. Falta la Fase 4, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar `pricing.proto` a `packages/contracts/proto`.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL de `ms_pricing.sql`, incluida la extensión `btree_gist`.
- [x] `PricingRepository`:
  - Tarifa vigente: `tar_vigente_desde <= fecha` y `tar_vigente_hasta` nulo o `>= fecha`.
  - `setPriceTable`: en una transacción, cierra la versión anterior, inserta una fila por tipo y escribe el outbox si rige hoy.
  - `23P01` en `ex_tarifa_sin_solape` → `TARIFF_OVERLAP`.

### Fase 2 · Servicio gRPC
- [x] `Health` con los campos de `NodeHealthResponse`.
- [x] `QuoteTickets`: al menos una línea y cantidades `>= 1`; sin tarifa → `PRICE_NOT_AVAILABLE`; montos a 2 decimales.
- [x] `GetPriceTable`: `NOT_FOUND` si no hay tabla vigente en esa fecha.
- [x] `ListTariffs` y `SetPriceTable`, con `adult > 0`, y `child`, `senior` y `student` `>= 0`.

### Fase 3 · Eventos
- [x] Publicador del outbox hacia RabbitMQ.
- [x] `TARIFA_ACTUALIZADA` con la tabla vigente hoy.
- [x] Proceso de la decisión 4. Repetir un evento no hace daño: trae la tabla completa.

### Fase 4 · Integración
- [ ] **ESB:** registrar las rutas `pricing.*`.
- [ ] **Order:** `QuoteTickets` con `atr_codigo`, `fecha` y las líneas de boletos.
- [ ] **Catalog:** consumir `TARIFA_ACTUALIZADA` por `atr_codigo`.
- [ ] **GraphQL:** tarifas en el panel.

## 6. Criterios de aceptación

- Dos versiones de una tarifa no pueden cruzar sus vigencias.
- Una tarifa futura aplica a las actividades desde esa fecha, y las anteriores conservan la tarifa vigente.
- Cambiar una tarifa no altera una orden existente.
- El día que empieza una tarifa, Catalog recibe los precios nuevos.
- Un tipo sin tarifa responde `PRICE_NOT_AVAILABLE`, y nunca cobra $0.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Pricing caído | La compra no continúa, porque no hay precio confiable. El catálogo sigue con los precios guardados en Catalog |
| Servicio apagado durante la medianoche | Al arrancar, el proceso revisa los últimos 7 días |
| Precio de Catalog distinto al de la fecha de la actividad | Catalog muestra el precio de hoy, como precio "desde"; Order siempre cotiza con Pricing |
