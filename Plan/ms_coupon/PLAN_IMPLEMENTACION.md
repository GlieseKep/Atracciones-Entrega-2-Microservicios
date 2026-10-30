# Plan de implementación · ms_coupon (Coupon & Promotions Service, REST)

| | |
|---|---|
| Microservicio | 9 · Coupon & Promotions Service |
| Protocolo | REST (detrás del API Gateway y el ESB) |
| Clasificación (arquitectura_esb_v3) | Síncrono: ESB → GraphQL directo. Booking Prototipo lo consulta por REST. |
| Contrato | [ms_coupon-openapi.yaml](ms_coupon-openapi.yaml) |
| Contrato externo | `GET` y `PUT /atracciones/promociones/contrato` de `atracciones-openapi-v3(1).yaml` |
| Base de datos | [ms_coupon.sql](ms_coupon.sql) → base `ms_coupon` |
| Ref. externas | `ciu_id` (Location). Los usos se cuentan en `orden_cupon` (Order) |
| Puerto local propuesto | `PORT=4011` |

## 1. Objetivo

Programar el servicio dueño de los cupones del portal y del acuerdo de promociones con Booking Prototipo.

## 2. Base del diseño

| Fuente | Qué define |
|---|---|
| Sección 9 de `02_microservicios_v2_bases_de_datos.sql` | Remite al script propio `ms_coupon.sql`: `cupon`, `acuerdo_promocion`, `acuerdo_promocion_destino` y el acuerdo inicial |
| `arquitectura_esb_v3.html` | Booking Prototipo usa `GET` y `PUT /promociones/contrato`. Order valida el cupón y su vigencia por REST. Los destinos apuntan a `ciudad` |
| Contrato v3 | `PromocionesContratoResponse`, `ActualizarPromocionesContratoRequest`, descuento máximo de 50 % |
| Plan de Order | La validación debe devolver `cup_id`. Order cuenta los usos en su transacción |

`ms_coupon.sql` no cambia en sus tablas. Las tarifas incluyen IVA, así que el descuento se calcula sobre el precio final.

## 3. Decisiones (confirmadas el 2026-10-30)

El diseño y el contrato no definen estos puntos.

1. **Quién responde el cuestionario.** El contrato dice que lo hace la tienda socia, y la arquitectura pone a Booking Prototipo en `PUT`.
   `GET` y `PUT` aceptan `X-API-Key` de Booking Prototipo o JWT de `ADMIN`.
2. **Destinos.** El script guarda `ciu_id` y el contrato usa nombres. Se convierten con `/internal/ciudades/resolucion` de
   Location. Un nombre desconocido responde `400`. Efecto a tener en cuenta: `Galápagos` es una provincia, así que se guardan sus ciudades,
   y la respuesta las devuelve por nombre, no como `Galápagos`.
3. **Actualizar el acuerdo.** Los campos opcionales que no se envían conservan su valor, y `destinos_habilitados` reemplaza la
   lista. `fecha_acuerdo` pasa a hoy. Si `permite_promociones` es `false`, el porcentaje se guarda en `0`.
4. **Acuerdo vencido.** `GET` lo responde igual, con su `vigencia_hasta`, y Booking Prototipo decide.
5. **Vigencia del cupón.** Se compara con la fecha de compra, no con la de la actividad: el cupón se usa al pagar.
6. **Cambiar un cupón.** Solo vigencia, límite de usos y estado. Para otro descuento se crea otro cupón. No se borran.
7. **Administración.** `/cupones` y `/cupones/{code}` son solo para `ADMIN`.
8. **Validación.** La pueden llamar un usuario autenticado, para la vista previa, y Order con `X-Service-Token`. Un cupón que no
   aplica responde `200` con `valid = false`, y Order lo convierte en `422`.

## 4. Estructura del servicio (`apps/services/ms-coupon`)

```
apps/services/ms-coupon/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts
    main.ts
    app.ts                           configuración y rutas (prefijo /api/v3)
    contract.ts                      tipos del contrato
    application/
      coupon-input.ts                validación
      discount.ts                    vigencia y cálculo del descuento
      agreement.ts                   cuestionario y destinos
    integration/
      esb-routes.ts                  rutas para registrar en el ESB
      coupon-client.ts               cliente para los demás componentes
      location-client.ts
    persistence/
      data-source.ts
      coupon-repository.ts
      agreement-repository.ts
      migrations/
        index.ts
        <timestamp>-CouponSchema.ts  DDL y acuerdo inicial de ms_coupon.sql
```

## 5. Fases

**Estado (2026-10-30):** Fases 0 a 2 programadas en `apps/services/ms-coupon`; compila y el contrato pasa Spectral sin errores. Sin pruebas. Falta la Fase 3, excepto las rutas para el ESB y el cliente, que ya están dentro del servicio.

### Fase 0 · Preparación
- [x] Cerrar las decisiones de la sección 3.
- [x] Copiar el contrato a `packages/contracts/openapi/ms-coupon.yaml` y lintarlo con Spectral.
- [x] Registrar el servicio en el workspace, la compilación, la creación de bases y el script de arranque.

### Fase 1 · Persistencia
- [x] Migración con el DDL y el acuerdo inicial de `ms_coupon.sql`.
- [x] `CouponRepository`: listar, crear, leer por código y modificar. `23505` en `cup_codigo` → `409 COUPON_EXISTS`.
- [x] `AgreementRepository`: leer el acuerdo con sus destinos y guardarlo en una transacción.

### Fase 2 · API REST
- [x] `GET` y `PUT /atracciones/promociones/contrato`, según las decisiones 1 a 4.
- [x] `GET` y `POST /cupones`, `GET` y `PATCH /cupones/{code}`.
- [x] `POST /cupones/validacion`, con `cup_id`, `discount_amount` y `max_uses`.
- [x] `/health` con `NodeHealthResponse`, y errores RFC 7807.

### Fase 3 · Integración
- [ ] **ESB:** registrar las rutas `coupon.*`, con `PATCH`.
- [ ] **API Gateway / Partner API:** exponer `/atracciones/promociones/contrato`.
- [ ] **Order:** validar el cupón al crear la orden.
- [ ] **GraphQL:** vista previa en el portal, y cupones y acuerdo en el panel.

## 6. Criterios de aceptación

- `GET /atracciones/promociones/contrato` siempre responde, y coincide con `PromocionesContratoResponse`.
- Un porcentaje mayor que 50 responde `400`.
- Un descuento `FIJO` nunca supera el subtotal.
- Un cupón inactivo, vencido o que aún no empieza da `valid = false` y descuento `0`.
- La validación no consume el cupón.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Location caído al actualizar el acuerdo | El `PUT` falla sin cambiar nada. El `GET` usa los nombres en caché |
| Cupón con límite agotado que pasa la validación | Order cuenta los usos en su transacción y responde `422` |
| Coupon caído en una compra con cupón | La compra no continúa; sin cupón no depende de este servicio |
