#!/usr/bin/env bash
# Crea y configura la única App Service de TourGirls (Plan/PLAN_DESPLIEGUE_UNA_APP.md, Parte 3, paso 3): plan B1 en
# West US 3, la app tourgirls-gateway-mm, Always On, HTTPS, TLS 1.2, health check, comando de inicio, publicación básica y
# variables de entorno. Se ejecuta en Azure Cloud Shell (Bash) y se puede repetir: solo reemplaza valores.
#
# Proyecto educativo: las URL de Booking y del broker central van escritas. Pide la contraseña de la base y los secretos.
RG=rg-tourgirls; PLAN=asp-tourgirls-b1; APP=tourgirls-gateway-mm; REGION=westus3; SKU=B1
DB_HOST=tourgirls-db-mms.postgres.database.azure.com; ADMIN=touradmin
RABBIT='amqps://qkvqjvku:ATBxToI1JvR6YbRBIIAnATa5mnjdIqz_@shark.rmq.cloudamqp.com/qkvqjvku'
STOCK_URL='https://booking-puce.eastus.cloudapp.azure.com/api/v3/inventory/stock'
GRPC_URL='booking-puce.eastus.cloudapp.azure.com:50051'
# Booking Central: recibe el aviso del check-in presencial (el ESB usa la misma BOOKING_API_KEY).
CORE_URL='https://booking-core-api.azurewebsites.net'
WEB='https://nice-bay-0fae5090f.3.azurestaticapps.net'

read -rp "Contraseña de $ADMIN (como en la URL): " DBPASS
read -rp 'INTERNAL_TOKEN_SECRET: ' INTERNAL
read -rp 'SERVICE_TOKEN: ' SVC
read -rp 'JWT_SECRET: ' JWT
read -rp 'WEBHOOK_SECRET: ' WEBHOOK
read -rp 'VOUCHER_SECRET: ' VOUCHER
read -rp 'BOOKING_API_KEY (la X-API-Key de la ficha): ' STOCK_KEY

# Los servicios no arrancan con secretos de menos de 32 caracteres.
for pair in "INTERNAL_TOKEN_SECRET:$INTERNAL" "SERVICE_TOKEN:$SVC" "JWT_SECRET:$JWT" "WEBHOOK_SECRET:$WEBHOOK" "VOUCHER_SECRET:$VOUCHER"; do
  name=${pair%%:*}; value=${pair#*:}
  [ ${#value} -ge 32 ] || { echo "ERROR: $name tiene ${#value} caracteres; debe tener al menos 32."; exit 1; }
done

# 1. Plan y app (solo si faltan).
if [ -z "$(az appservice plan list -g $RG --query "[?name=='$PLAN'].name" -o tsv)" ]; then
  az appservice plan create -g $RG -n $PLAN --is-linux --sku $SKU --location $REGION --output none && echo "OK plan $PLAN ($SKU)" || exit 1
fi
if [ -z "$(az webapp list -g $RG --query "[?name=='$APP'].name" -o tsv)" ]; then
  az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:22-lts" --output none && echo "OK app $APP" || exit 1
fi

# 2. Configuración general: HTTPS, TLS 1.2, Always On, comando de inicio y health check.
az webapp update -g $RG -n $APP --https-only true --output none &&
az webapp config set -g $RG -n $APP --always-on true --min-tls-version 1.2 --startup-file "node tools/launcher.mjs" \
  --generic-configurations '{"healthCheckPath": "/health"}' --output none && echo "OK configuración general" || exit 1

# 3. Publicación básica (SCM), para descargar el perfil que usa GitHub Actions.
az resource update --ids "$(az webapp show -g $RG -n $APP --query id -o tsv)/basicPublishingCredentialsPolicies/scm" \
  --set properties.allow=true --output none && echo "OK publicación básica"

# 4. Variables de entorno.
az webapp config appsettings set -g $RG -n $APP --output none --settings \
  "DATABASE_SERVER_URL=postgres://$ADMIN:$DBPASS@$DB_HOST:5432" DATABASE_SSL=true DB_POOL_MAX=2 \
  "RABBITMQ_URL=$RABBIT" RABBITMQ_EXCHANGE=booking.events RABBITMQ_PREFIX=tourgirls \
  "BOOKING_REST_STOCK_URL=$STOCK_URL" "BOOKING_GRPC_URL=$GRPC_URL" "BOOKING_API_KEY=$STOCK_KEY" "BOOKING_CORE_URL=$CORE_URL" \
  "INTERNAL_TOKEN_SECRET=$INTERNAL" "SERVICE_TOKEN=$SVC" "JWT_SECRET=$JWT" "WEBHOOK_SECRET=$WEBHOOK" "VOUCHER_SECRET=$VOUCHER" \
  "PORTAL_URL=$WEB" "CORS_ORIGINS=$WEB" "PUBLIC_BASE_URL=https://$APP.azurewebsites.net/api/v3" \
  ESB_TIMEOUT_FACTOR=3 HEALTH_TIMEOUT_MS=4000 HEALTH_UP_MS=2500 HEALTH_DOWN_MS=4500 HEALTH_CACHE_MS=10000 \
  NODE_ENV=production SCM_DO_BUILD_DURING_DEPLOYMENT=false WEBSITES_CONTAINER_START_TIME_LIMIT=600 \
  && echo "OK variables de entorno" || exit 1

echo "=== TERMINADO ==="
