# Arranca la cadena completa de microservicios de Descubre EC, una ventana por proceso.
# Requisitos (Plan/GUIA_LOCAL_TAILSCALE.md):
#   paso 2: docker compose -f infra/docker-compose.yml up -d   (PostgreSQL, RabbitMQ, Redis)
#   paso 3: npm run build  y  npm run db:migrate
#
# Uso:  powershell -ExecutionPolicy Bypass -File .\start-microservices.ps1
#
# Para la reunion con Booking: cambia BOOKING_STOCK_GRPC (inventory) por <ip-tailscale-de-booking>:50051
# y PUBLIC_BASE_URL (partner-api) por http://<tu-ip-tailscale>:3000/api/v2, y vuelve a ejecutar.
$root = $PSScriptRoot

# Configuracion comun. INTERNAL_TOKEN_SECRET: el mismo en todos, 32 caracteres o mas.
$common = @{
  INTERNAL_TOKEN_SECRET = 'cambia-esto-por-un-secreto-largo-de-32-caracteres'
  SERVICE_TOKEN = 'service-token-local-solo-para-desarrollo'
  RABBITMQ_URL          = 'amqp://guest:guest@localhost:5672'
  REDIS_URL             = 'redis://localhost:6379'
}

# Proceso => archivo y variables propias. Orden: servicios, luego ESB, Partner API, GraphQL y Gateway.
$apps = [ordered]@{
  'sri-mock'     = @{ file = 'apps/sri-mock/dist/main.js'; env = @{} }
  'booking-mock' = @{ file = 'apps/booking-mock/dist/main.js'; env = @{} }   # solo para probar sin Booking
  'identity'     = @{ file = 'apps/services/identity/dist/main.js'; env = @{ ADMIN_EMAIL = 'admin@descubreec.test'; ADMIN_PASSWORD = 'Admin-Local-2026' } }
  'ms-identity'  = @{ file = 'apps/services/ms-identity/dist/main.js'; env = @{ JWT_SECRET = 'jwt-secret-local-ms-identity-solo-desarrollo' } }
  'ms-catalog'   = @{ file = 'apps/services/ms-catalog/dist/main.js'; env = @{} }
  'ms-inventory' = @{ file = 'apps/services/ms-inventory/dist/main.js'; env = @{ BOOKING_STOCK_GRPC = 'localhost:50051'; BOOKING_SERVICE_ID = 'NODE_ATR_DILAN' } }
  'ms-cart'      = @{ file = 'apps/services/ms-cart/dist/main.js'; env = @{} }
  'ms-payment'   = @{ file = 'apps/services/ms-payment/dist/main.js'; env = @{ WEBHOOK_SECRET = 'webhook-secret-local-solo-para-desarrollo' } }
  'ms-billing-profile' = @{ file = 'apps/services/ms-billing-profile/dist/main.js'; env = @{} }
  'catalog'      = @{ file = 'apps/services/catalog/dist/main.js'; env = @{} }
  'ms-location'  = @{ file = 'apps/services/ms-location/dist/main.js'; env = @{} }
  'ms-review'    = @{ file = 'apps/services/ms-review/dist/main.js'; env = @{} }
  'inventory'    = @{ file = 'apps/services/inventory/dist/main.js'; env = @{ BOOKING_SYNC_ENABLED = 'true'; BOOKING_STOCK_GRPC = 'localhost:50051' } }
  'cart'         = @{ file = 'apps/services/cart/dist/main.js'; env = @{} }
  'order'        = @{ file = 'apps/services/order/dist/main.js'; env = @{} }
  'booking'      = @{ file = 'apps/services/booking/dist/main.js'; env = @{} }
  'payment'      = @{ file = 'apps/services/payment/dist/main.js'; env = @{} }
  'ms-refund'    = @{ file = 'apps/services/ms-refund/dist/main.js'; env = @{} }
  'invoicing'    = @{ file = 'apps/services/invoicing/dist/main.js'; env = @{} }
  'audit'        = @{ file = 'apps/services/audit/dist/main.js'; env = @{} }
  'ms-support'   = @{ file = 'apps/services/ms-support/dist/main.js'; env = @{} }
  'esb'          = @{ file = 'apps/esb/dist/main.js'; env = @{} }
  'partner-api'  = @{ file = 'apps/partner-api/dist/main.js'; env = @{ PUBLIC_BASE_URL = 'http://localhost:3000/api/v2' } }
  'graphql'      = @{ file = 'apps/graphql/dist/main.js'; env = @{} }
  'gateway'      = @{ file = 'apps/gateway/dist/main.js'; env = @{ GRAPHQL_URL = 'http://127.0.0.1:3200' } }
}

# Sin compilar no hay dist/main.js: se avisa antes de abrir 15 ventanas que fallarian.
$missing = @($apps.Keys | Where-Object { -not (Test-Path (Join-Path $root $apps[$_].file)) })
if ($missing.Count -gt 0) {
  Write-Host "Faltan archivos compilados de: $($missing -join ', '). Ejecuta 'npm run build' primero." -ForegroundColor Red
  exit 1
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
