# Guía · Correr Descubre EC en local y conectarse con Booking por Tailscale

Objetivo de la reunión:

1. El proyecto corre sin problemas en la máquina local.
2. Los backends aceptan peticiones externas (escuchan en `0.0.0.0`).
3. Booking se conecta por Tailscale a las IPs privadas de cada equipo.

No hace falta Azure. Que cada microservicio tenga su base no significa un servidor por microservicio: **un solo PostgreSQL** (en Docker) guarda todas las bases (`identity_db`, `catalog_db`, …, `ms_cart`, `ms_coupon`, `ms_pricing`).

---

## 0. Qué vamos a levantar

```
Booking (por Tailscale) ──► Gateway :3000 ──► Partner API :3100 ──► ESB :3300 ──► servicios
Portal (opcional)       ──►       └──────► GraphQL :3200 ──────────┘
                                                                     │
Servicios: Identity 4001 · Catalog 4002 · Cart 4004 · Payment 4007 · Invoicing 4008 · Audit 4009   (REST)
           Inventory 50061 · Order 50065 · Booking 50066                                            (gRPC)
Simuladores: SRI 4091 · Booking gRPC 50051 (solo para probar sin Booking)
Docker: PostgreSQL 5433 · RabbitMQ 5672 (consola 15672) · Redis 6379
```

- **Solo el Gateway (3000) se expone a Booking.** El resto se comunica dentro de la máquina.
- **Todo escucha en `0.0.0.0`.** El Gateway lo fija en `apps/gateway/src/main.ts`, y los demás servicios usan `listen()` y `startGrpcServer()` de `@atracciones/platform`, que lo traen por defecto.
- **RabbitMQ es obligatorio.** Cada servicio corre en su propio proceso, y sin RabbitMQ los eventos (Payment → Order → Invoicing, outbox de Booking) no viajan entre procesos. Una compra quedaría a medias.
- **ms_cart, ms_coupon y ms_pricing todavía no están conectados al resto** (la Fase 3 de sus planes está pendiente). Para la reunión se usan los servicios actuales; los nuevos se pueden levantar aparte (paso 9).

> ⚠️ **Versión del contrato.** La Partner API hoy expone `/api/v2` y `/api/v1`, no `/api/v3`. El contrato v3 lista `/api/v2` como "ruta de compatibilidad mantenida activa", así que Booking puede integrarse por `/api/v2`. Si exigen `/api/v3`, falta adaptar la Partner API (rutas y esquemas `CreateReservaRequestV3`, etc.). Conviene confirmarlo con Booking **antes** de la reunión.

---

## 1. Requisitos

- Node.js 22 o superior (`node -v`).
- Docker Desktop corriendo.
- Tailscale instalado y con sesión iniciada.
- Que no esté corriendo `npm run db:local` ni `start-local.cmd`, porque usan el mismo puerto 5433 que el PostgreSQL de Docker. Para detenerlos: `start-local.cmd -Stop`.

## 2. Infraestructura en Docker

Desde la raíz del repo:

```powershell
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps     # postgres, rabbitmq y redis en "healthy"
```

- **PostgreSQL:** `localhost:5433`, usuario `postgres`, clave `tourgirls-local` (la misma que usan los servicios por defecto).
- **RabbitMQ:** consola en http://localhost:15672 (`guest` / `guest`).
- **Redis:** `localhost:6379`.

> `infra/postgres/init.sql` solo se ejecuta la **primera** vez que se crea el volumen. Si el volumen ya existía no pasa nada: el paso 3 crea las bases que falten.

## 3. Compilar y crear las bases

```powershell
npm install
npm run build
npm run db:migrate          # crea cada base si no existe y le aplica sus migraciones
```

Salida esperada: una línea por servicio, por ejemplo `[catalog] catalog_db: 2 migraciones aplicadas`, `[ms-cart] ms_cart: al día`.

## 4. Arrancar todos los procesos

El script [`start-microservices.ps1`](../start-microservices.ps1), en la raíz del repo, abre una ventana de PowerShell por proceso, todas con la misma configuración. Si falta compilar algún componente, avisa y no abre nada. Se ejecuta con:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-microservices.ps1
```

```powershell
# start-microservices.ps1 · arranca la cadena completa (requiere el paso 2 y el paso 3)
$root = $PSScriptRoot

# Configuración común. INTERNAL_TOKEN_SECRET: el mismo en todos, 32 caracteres o más.
$common = @{
  INTERNAL_TOKEN_SECRET = 'cambia-esto-por-un-secreto-largo-de-32-caracteres'
  RABBITMQ_URL          = 'amqp://guest:guest@localhost:5672'
  REDIS_URL             = 'redis://localhost:6379'
}

# Proceso => archivo y variables propias. El orden importa: primero los servicios, luego ESB, Partner API, GraphQL y Gateway.
$apps = [ordered]@{
  'sri-mock'     = @{ file = 'apps/sri-mock/dist/main.js'; env = @{} }
  'booking-mock' = @{ file = 'apps/booking-mock/dist/main.js'; env = @{} }   # solo para probar sin Booking (paso 6)
  'identity'     = @{ file = 'apps/services/identity/dist/main.js'; env = @{ ADMIN_EMAIL = 'admin@descubreec.test'; ADMIN_PASSWORD = 'Admin-Local-2026' } }
  'catalog'      = @{ file = 'apps/services/catalog/dist/main.js'; env = @{} }
  'inventory'    = @{ file = 'apps/services/inventory/dist/main.js'; env = @{ BOOKING_SYNC_ENABLED = 'true'; BOOKING_STOCK_GRPC = 'localhost:50051' } }
  'cart'         = @{ file = 'apps/services/cart/dist/main.js'; env = @{} }
  'order'        = @{ file = 'apps/services/order/dist/main.js'; env = @{} }
  'booking'      = @{ file = 'apps/services/booking/dist/main.js'; env = @{} }
  'payment'      = @{ file = 'apps/services/payment/dist/main.js'; env = @{} }
  'invoicing'    = @{ file = 'apps/services/invoicing/dist/main.js'; env = @{} }
  'audit'        = @{ file = 'apps/services/audit/dist/main.js'; env = @{} }
  'esb'          = @{ file = 'apps/esb/dist/main.js'; env = @{} }
  'partner-api'  = @{ file = 'apps/partner-api/dist/main.js'; env = @{ PUBLIC_BASE_URL = 'http://localhost:3000/api/v2' } }
  'graphql'      = @{ file = 'apps/graphql/dist/main.js'; env = @{} }
  'gateway'      = @{ file = 'apps/gateway/dist/main.js'; env = @{ GRAPHQL_URL = 'http://127.0.0.1:3200' } }
}

foreach ($name in $apps.Keys) {
  $vars = @{}
  foreach ($k in $common.Keys) { $vars[$k] = $common[$k] }
  foreach ($k in $apps[$name].env.Keys) { $vars[$k] = $apps[$name].env[$k] }
  $set = ($vars.GetEnumerator() | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)'" }) -join '; '
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$name'; Set-Location '$root'; $set; node $($apps[$name].file)"
  Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $cmd | Out-Null
  Start-Sleep -Milliseconds 400
}
Write-Host 'Procesos lanzados. Revisa cada ventana: deben decir "listo".' -ForegroundColor Green
```

- **Ventanas:** cada una debe terminar con un mensaje "… listo" y su puerto. Una que se cierre o muestre un error indica el proceso con problemas (lo más común: Docker apagado o falta el paso 3).
- **Datos de ejemplo:** Catalog e Inventory cargan el catálogo inicial y generan turnos de los próximos 60 días (`SEED_CATALOG` y `SLOT_DAYS`).
- **Administrador:** Identity crea el usuario administrador con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
- **Clave de firma:** sin `JWT_PRIVATE_KEY_PEM`, Identity usa una clave temporal. Los tokens de usuario dejan de valer si se reinicia Identity. Las `X-API-Key` de Booking no se afectan.
- **Para detener todo:** cierra las ventanas y luego `docker compose -f infra/docker-compose.yml stop`.

## 5. Crear la `X-API-Key` para Booking

Con la infraestructura arriba:

```powershell
node tools/create-api-key.mjs --nombre booking-prototipo --email integracion@booking.epn.edu.ec
```

La clave se muestra **una sola vez**; guárdala para dársela a Booking en la reunión. En la base solo queda su hash.

## 6. Probar todo en local (antes de la reunión)

Con `curl.exe` (no el alias `curl` de PowerShell) o Postman, contra el Gateway.

> `http://localhost:3000/api/v2` es solo el **prefijo** de las rutas: abrirlo solo responde `404 NOT_FOUND`, y eso es correcto (confirma que el Gateway y la Partner API responden). Las rutas `GET` sin clave (salud, catálogo, disponibilidad) también se pueden abrir en el navegador, por ejemplo http://localhost:3000/api/v2/atracciones/health. Las que necesitan `X-API-Key` no, porque el navegador no envía esa cabecera.

```powershell
$base = 'http://localhost:3000/api/v2'
$key  = '<la X-API-Key del paso 5>'

# Salud del nodo (semáforo que ve Booking): status UP
curl.exe "$base/atracciones/health"

# Catálogo: anota el "id" de una atracción
curl.exe "$base/atracciones?limit=3"

# Disponibilidad de una fecha futura: anota un "slot_id" y su "hora"
curl.exe "$base/atracciones/<id>/disponibilidad?date=2026-11-15"

# Promociones (contrato B2B)
curl.exe -H "X-API-Key: $key" "$base/atracciones/promociones/contrato"
```

Compra con contrato de Saga (201 la primera vez; repetir con la **misma** `Idempotency-Key` debe devolver la misma respuesta sin duplicar):

```powershell
$idem = [guid]::NewGuid().ToString()
$body = @'
{
  "atraccion_id": "<id>",
  "fecha": "2026-11-15",
  "slot_id": "<slot_id>",
  "hora": "<hora HH:mm:ss>",
  "adult_count": 2,
  "customer": { "full_name": "Paul Rosero", "email": "paul.rosero@epn.edu.ec", "phone": "+593991234567", "document_type": "CEDULA", "document_id": "1710034065" },
  "payment_method": "SOA_BOOKING_GATEWAY"
}
'@
$body | Out-File -Encoding utf8 reserva.json
curl.exe -i -X POST "$base/atracciones/reservas" -H "Content-Type: application/json" -H "X-API-Key: $key" -H "Idempotency-Key: $idem" --data "@reserva.json"
```

Qué revisar:
- **Compra:** responde `201` con `external_order_id`, `reservation_code` y `voucher_qr_payload`.
- **Sin cupos:** pedir más boletos que los disponibles responde `409` con `code: OUT_OF_STOCK`.
- **Eventos:** `GET $base/atracciones/eventos` (con la `X-API-Key`) muestra `RESERVA_CREADA` / `RESERVA_CONFIRMADA`.
- **Stock por gRPC:** `booking-mock` recibe el `PushStockUpdate` que Inventory envía después de la compra. Tiene un servidor de inspección HTTP en `http://localhost:4090`; revisa su ventana y ese servidor para confirmar que llegó.
- **Cancelación:** `POST $base/atracciones/reservas/<reservation_id>/cancel` con otra `Idempotency-Key` devuelve los cupos.

Si todo esto funciona en local, la lógica está lista; lo demás es red.

## 7. Abrir el puerto del Gateway a la red de Tailscale

Aunque el Gateway escuche en `0.0.0.0`, **el Firewall de Windows bloquea por defecto** lo que llega de otra máquina, también por Tailscale. En PowerShell **como administrador**:

```powershell
New-NetFirewallRule -DisplayName 'Descubre EC - Gateway 3000 (Tailscale)' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -RemoteAddress 100.64.0.0/10
```

`100.64.0.0/10` es el rango de IPs de Tailscale: el puerto solo queda abierto para los equipos de la red privada, no para toda la red local o pública.

Para quitar la regla después de la entrega:

```powershell
Remove-NetFirewallRule -DisplayName 'Descubre EC - Gateway 3000 (Tailscale)'
```

## 8. Tailscale (en la reunión)

1. **Tu IP privada:**
   ```powershell
   tailscale ip -4        # algo como 100.101.102.103
   tailscale status       # equipos conectados en la misma red
   ```
2. **Unirse a la misma red:** aceptar la invitación al tailnet o compartir el nodo con los compañeros, como indiquen en la llamada.
3. **Lo que se les da a Booking:**
   - URL base: `http://<tu-ip-tailscale>:3000/api/v2` (o `/api/v3` cuando esté adaptada).
   - La `X-API-Key` del paso 5.
4. **Lo que se les pide:** la IP Tailscale de su servidor gRPC de stock (puerto 50051).
5. **Apuntar Inventory a Booking:** cerrar la ventana `inventory` y `booking-mock`, y volver a lanzar `inventory` con:
   ```powershell
   $env:INTERNAL_TOKEN_SECRET = '<el mismo del script>'
   $env:RABBITMQ_URL = 'amqp://guest:guest@localhost:5672'
   $env:BOOKING_SYNC_ENABLED = 'true'
   $env:BOOKING_STOCK_GRPC = '<ip-tailscale-de-booking>:50051'
   node apps/services/inventory/dist/main.js
   ```
   (o cambiar `BOOKING_STOCK_GRPC` en el script y relanzarlo).
6. **Actualizar los enlaces de la Partner API:** relanzar `partner-api` con `PUBLIC_BASE_URL = 'http://<tu-ip-tailscale>:3000/api/v2'`, para que los enlaces HATEOAS que recibe Booking usen tu IP.
7. **Probar la conexión cruzada:** que Booking (o un compañero desde su máquina) ejecute:
   ```
   curl http://<tu-ip-tailscale>:3000/api/v2/atracciones/health
   ```
   Si no responde, en este orden:
   - **Tailscale:** ¿ves su equipo en `tailscale status`?
   - **Firewall:** ¿existe la regla del paso 7?
   - **Gateway:** ¿responde en local (`curl.exe http://localhost:3000/api/v2/atracciones/health`)?

## 9. (Opcional) Levantar ms_cart, ms_coupon y ms_pricing

Ya tienen sus bases creadas (paso 3). Se pueden arrancar para mostrarlos, pero **todavía nadie los llama**: el ESB, Order, GraphQL y la Partner API siguen usando Cart, Catalog e Inventory hasta completar la Fase 3 de sus planes.

```powershell
$env:INTERNAL_TOKEN_SECRET = '<el mismo del script>'
$env:RABBITMQ_URL = 'amqp://guest:guest@localhost:5672'
node apps/services/ms-cart/dist/main.js      # REST :4012  (GET http://localhost:4012/health)
node apps/services/ms-coupon/dist/main.js    # REST :4011  (GET http://localhost:4011/health)
node apps/services/ms-pricing/dist/main.js   # gRPC :50062
```

## 10. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5433` | Docker apagado o PostgreSQL no levantó | `docker compose -f infra/docker-compose.yml ps` y revisar `postgres` |
| `database "xxx" does not exist` | Faltó el paso 3 | `npm run db:migrate` |
| La compra queda en `PENDING` o sin factura | RabbitMQ caído o un servicio sin `RABBITMQ_URL` | Revisar la consola de RabbitMQ (15672) y la variable en cada ventana |
| `401` en todas las rutas | `INTERNAL_TOKEN_SECRET` distinto entre procesos | Usar el mismo valor en todos y relanzar |
| `Cannot find module …/dist/main.js` | Faltó compilar | `npm run build` |
| Desde otra máquina no responde, en local sí | Firewall de Windows | Paso 7 |
| El puerto 3000 ya está en uso | Otro proceso (otro Gateway o `start-local`) | `Get-NetTCPConnection -LocalPort 3000` y cerrar ese proceso |

## Pendientes conocidos (no bloquean la reunión)

- **Contrato v3:** la Partner API expone `/api/v2` y `/api/v1`. Si Booking exige `/api/v3`, hay que adaptarla.
- **Servicios nuevos sin conectar:** ms_cart, ms_coupon y ms_pricing funcionan aislados; falta la Fase 3 de sus planes (ESB, Order, GraphQL, Partner API).
- **Azure:** más adelante se usa un solo servidor de Azure Database for PostgreSQL con varias bases (`SERVICES_DATABASE_URL`, `DATABASE_SSL=true`, `npm run db:migrate`), y cada componente se despliega como su propio servicio.
