# Plan de integración · TourGirls

| | |
|---|---|
| Objetivo | Conectar ESB, Gateway, Partner API, GraphQL y el portal con los 16 microservicios nuevos, y publicar todo en Azure |
| Estado (2026-10-31) | Fases 1 a 5 programadas y compiladas, sin ejecutar contra los servicios reales. La Fase 7 espera la decisión 6. Ninguna compra ha pasado de punta a punta |
| Despliegue | [DESPLIEGUE_AZURE_MICROSERVICIOS.md](DESPLIEGUE_AZURE_MICROSERVICIOS.md) |
| Booking Prototipo | `GUIA_SOCIOS_AZURE_APP_SERVICE(1).md` |

## 1. Punto de partida

| Pieza | Situación actual | Qué falta |
|---|---|---|
| ESB | 81 rutas hacia los servicios viejos | Registrar las 149 rutas nuevas |
| Gateway | Reenvía a Partner API, Identity, GraphQL y al monolito | Validar el token nuevo y dejar de depender del monolito |
| Partner API | Aún usa operaciones viejas y `/api/v2` por defecto | Publicar `/api/v3` y usar las operaciones nuevas |
| GraphQL | Aún usa operaciones viejas | Usar los clientes de cada servicio |
| Portal | Llama a `/api/v1` | Adaptar rutas, respuestas y sesión a v3 |
| Empaquetado | `tools/package-backend.mjs` solo arma `api` y `auth` | Armar las 20 apps e incluir los `.proto` |

Partner API y GraphQL usan juntos unas 47 operaciones del ESB. Cada una debe pasar a su operación nueva, y puede cambiar también la
forma de su entrada y su respuesta.

Rutas del ESB que hay que registrar, según `src/integration/esb-routes.ts` de cada servicio:

| Destino | Rutas | Destino | Rutas |
|---|---:|---|---:|
| `catalog` | 28 | `location` | 8 |
| `identity` | 24 | `payment` | 8 |
| `inventory` | 15 | `review` | 8 |
| `cart` | 10 | `order` | 6 |
| `coupon` | 8 | `pricing` | 5 |
| `billing` | 7 | `invoicing` | 4 |
| `booking` | 7 | `refund` | 4 |
| `audit` | 3 | `support` | 4 |

## 2. Decisiones ya tomadas

1. **Sin VM.** Los 20 procesos van en App Service. La VM con el puerto 50051 es la de Booking Prototipo.
2. **Llamadas internas por HTTP.** Booking, Order, Inventory y Pricing exponen `POST /internal/rpc/<Método>`. El `.proto` sigue siendo el
   contrato. Esto se aparta de `arquitectura_esb_v3.html`.
3. **Stock por REST.** `POST /api/v3/inventory/stock` con `X-API-Key`. La clave la genera la tienda y se envía a Booking en la ficha.
4. **Regiones.** App Service en West US 3 y PostgreSQL en Brazil South, en el servidor `tourgirls-db-mms`.
5. **Pasarela y SRI simulados.** La pasarela valida los pagos, sin confirmación de un administrador.

## 3. Decisiones pendientes

| # | Pregunta | Quién | Propuesta |
|---|---|---|---|
| 1 | ¿Cuál es la URL de stock: `booking-puce.eastus…` o `booking-puce.brazilsouth…`? | Equipo, con Booking | Usar la que confirme Booking en `BOOKING_REST_STOCK_URL` |
| 2 | ¿Dónde se despliega `apps/sri-mock`? | Equipo | Una app más en el mismo plan |
| 3 | ¿El feed de eventos público usa `ms-booking`? | Equipo | Sí: usar `booking.listEvents`, porque `ms-audit` no tiene `GET /eventos` |
| 4 | ¿Se migran los datos del despliegue anterior? | Equipo | Sí, con `tools/migrate-*`, antes de apagarlo |
| 5 | ¿Acepta el docente HTTP interno en lugar de gRPC? | Equipo | Confirmarlo antes de la entrega |
| 6 | El portal llama al monolito (`/api/v1`) y no usa GraphQL. ¿Por dónde pasa a los servicios nuevos? | Equipo | Ver la Fase 5 |

## 4. Fases

### Fase 1 · Base común
- [x] Hacer configurable el pool con `DB_POOL_MAX`. Hoy `max: 10` está fijo en `packages/platform/src/persistence/data-source.ts`.
- [ ] Revisar que 16 procesos con pool 3 quepan en el límite de conexiones de B1ms.
- [ ] Confirmar que todos los servicios reciben el contexto: correlación, principal e idempotencia.

### Fase 2 · ESB
- [x] Agregar los destinos nuevos y sus variables: `billing`, `coupon`, `location`, `refund`, `review` y `support`.
- [x] Reemplazar la tabla de rutas por los `MS_*_ROUTES` de cada servicio.
- [x] Revisar las rutas `*.health`: las REST nuevas usan `/api/v3/health` y las internas `/internal/rpc/Health`.
- [x] Subir los tiempos límite que hagan falta por la distancia con la base: `ESB_TIMEOUT_FACTOR` multiplica el plazo de cada ruta.
- [ ] Revisar `bodyLimit` y el circuit breaker con los plazos nuevos.
- [x] Exigir `X-Service-Token` en `/esb/*`: el ESB queda en internet. `EsbClient` lo envía desde `SERVICE_TOKEN`.
- [x] Quitar el adaptador gRPC cuando ya no quede ninguna ruta que lo use.

### Fase 3 · Identidad y Gateway
- [x] Validar el token de `ms-identity` con `identity.validateToken` por el ESB (HS256, sin JWKS), con caché de 30 s.
- [x] Construir el principal interno con el `usu_id` numérico y los roles en `scopes`.
- [x] Apuntar `identity.validateApiKey` a `ms-identity`, y confirmar que `tools/create-api-key.mjs` sirve con la base nueva.
- [x] Publicar `/api/v3/auth/**` (Identity), `/graphql` y el resto de `/api/v3` (Partner API).
- [x] Quitar la dependencia de `MONOLITH_URL`.

### Fase 4 · Partner API (contrato con Booking)
- [x] Publicar en `/api/v3` las rutas de la guía de socios:

  | Ruta | Requisito |
  |---|---|
  | `GET /api/v3/atracciones/health` | `status`, `database_connected` y `service: "Atracciones"` |
  | `GET /api/v3/atracciones` | Arreglo simple con `id`, `nombre`, `precio`, `ciudad`, `duracion` y `horarios`. Nuestra copia del contrato v3 cambia esta respuesta, y los horarios salen de `inventory.listScheduleTimes` |
  | `POST /api/v3/atracciones/reservas` | Crea la reserva |

- [x] Cambiar cada handler a las operaciones nuevas. Los servicios ya responden con las formas del contrato, así que los mappers se quitaron.
- [x] Validar contra `packages/contracts/openapi/atracciones-openapi-v3.yaml`. `/api/v3/health` queda como alias fuera del contrato.
- [x] Actualizar `PUBLIC_BASE_URL` por defecto y la lista de servicios de salud.

### Fase 5 · GraphQL

Cada operación del portal en el ESB (`apps/graphql/src/operations.ts`) es un campo `<servicio><Operación>` con `input: JSON`
y la respuesta del servicio en `JSON`. Así el esquema no repite los DTO de 16 servicios; los nombres de campos son los de cada
contrato en `Plan/ms_*`.

- [x] Reemplazar las llamadas por las operaciones nuevas: 58 consultas y 49 mutaciones, todas comprobadas contra las rutas del ESB.
- [x] Quitar el esquema, los mappers y los DTO de los servicios viejos.
- [x] Incluir la bitácora, los reembolsos, las facturas y los mensajes de contacto.
- [x] Invalidar la caché de lecturas públicas con `catalog.*`, `pricing.*` y `review.*`.
- [x] Agregar `me` y `systemHealth`.

### Fase 6 · Eventos y Booking Prototipo
- [ ] Revisar que cada consumidor use la clave real: `pricing.*`, `review.*`, `payment.*`, `order.*`, `refund.*`, `inventory.*` y `booking.*`.
- [ ] Definir `BOOKING_REST_STOCK_URL` y `BOOKING_API_KEY`.
- [ ] Generar la clave y preparar la ficha de registro.
- [ ] Resolver el feed de eventos y el SRI simulado (pendientes 2 y 3).

### Fase 7 · Portal web
- [ ] Cambiar `/api/v1` por `/api/v3` en `AtraccionesService-web/src/config/env.ts`.
- [ ] Adaptar el inicio de sesión y las pantallas a las respuestas nuevas.
- [ ] Apuntar `.env.production` al Gateway cuando esté publicado.

### Fase 8 · Empaquetado y despliegue
- [ ] Extender `tools/package-backend.mjs` a las 20 apps, con los `.proto` y contratos que se leen al arrancar.
- [ ] Crear un workflow que compile y publique en Linux, sin `Compress-Archive`.
- [ ] Habilitar la autenticación básica y cargar los perfiles de publicación en GitHub.
- [ ] Configurar el health check de cada app.

### Fase 9 · Corte
- [ ] Probar la compra completa en Azure.
- [ ] Migrar los datos que se decidan conservar.
- [ ] Enviar la ficha a Booking cuando el health responda 200.
- [ ] Quitar los servicios viejos de `apps/services`, sus protos y su registro en `services.json`.
- [ ] Borrar la VM con su disco e IP, y luego el despliegue anterior.

## 5. Dependencias

```
Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 6 ─┐
                       └→ Fase 5 → Fase 7 ──┴→ Fase 8 → Fase 9
```

La Fase 8 se puede adelantar para probar en Azure a medida que avanzan las demás.

## 6. Criterios de aceptación

- Un visitante completa una compra en el portal: orden, pago, reserva, factura y voucher.
- Una cancelación devuelve el dinero, libera los cupos y anula la factura si corresponde.
- Una compra se sigue de principio a fin por su `correlation_id` en la bitácora.
- Booking ve el health en verde, lee el catálogo, crea una reserva y recibe el stock.
- Ninguna ruta `/internal/**` responde sin `X-Service-Token`.
- Ninguna app depende de la VM, del monolito ni de un servicio viejo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Nada se ha ejecutado de punta a punta | Probar la compra completa apenas terminen las fases 2 a 4 |
| Latencia entre West US 3 y Brazil South | Medir la compra real y ajustar los plazos. Si no alcanza, reducir consultas por operación |
| 20 procesos en 3,5 GB | Revisar la memoria del plan. Si no alcanza, subir de plan o unir procesos |
| Pocas conexiones en B1ms | Aplicar `DB_POOL_MAX` antes de levantar las 20 apps |
| El crédito se agota | Crear un presupuesto y apagar lo que no se use |
| Cambios de contrato en Booking | Confirmar la URL y la ficha antes de la entrega |
