#!/usr/bin/env bash
# Configura las 20 apps de App Service de Descubre EC: las crea si faltan y define su comando de inicio y sus variables.
# Se ejecuta en Azure Cloud Shell (Bash) y se puede repetir: solo reemplaza valores.
#
# Específico de este despliegue: cambia RG, P, S, PLAN, ADMIN y DB_HOST para usarlo en otro.
# Los secretos no están escritos: los pide al ejecutarlo.
RG=rg-tourgirls; P=tourgirls; S=mm; PLAN=asp-tourgirls-michael
ADMIN=touradmin; DB_HOST=tourgirls-db-mms.postgres.database.azure.com

read -rp "Contraseña de $ADMIN (como en la URL): " DBPASS
read -rp 'RABBITMQ_URL: ' RABBIT
read -rp 'INTERNAL_TOKEN_SECRET: ' INTERNAL
read -rp 'SERVICE_TOKEN: ' SVC
read -rp 'JWT_SECRET: ' JWT
read -rp 'WEBHOOK_SECRET: ' WEBHOOK
read -rp 'VOUCHER_SECRET: ' VOUCHER
read -rp 'URL de la Static Web App (https://..., sin / final): ' WEB
read -rp 'BOOKING_REST_STOCK_URL (Enter si aún no se conoce): ' STOCK_URL
read -rp 'BOOKING_API_KEY (Enter si aún no se generó): ' STOCK_KEY

url() { echo "https://$P-$1-$S.azurewebsites.net"; }
SERVICES="ms-identity ms-location ms-catalog ms-billing-profile ms-pricing ms-inventory ms-review ms-coupon ms-cart ms-payment ms-order ms-booking ms-refund ms-invoicing ms-support ms-audit"
COMMON=("NODE_ENV=production" "SCM_DO_BUILD_DURING_DEPLOYMENT=false" "WEBSITES_CONTAINER_START_TIME_LIMIT=600"
  "INTERNAL_TOKEN_SECRET=$INTERNAL" "SERVICE_TOKEN=$SVC" "ESB_URL=$(url esb)" "RABBITMQ_URL=$RABBIT")

# Crea la app si falta, con HTTPS, TLS 1.2, Always On, comando de inicio y publicación básica (para GitHub Actions).
prepare() {
  local name=$P-$1-$S
  if [ -z "$(az webapp list -g $RG --query "[?name=='$name'].name" -o tsv)" ]; then
    az webapp create -g $RG -p $PLAN -n "$name" --runtime "NODE:22-lts" --output none || return 1
  fi
  az webapp update -g $RG -n "$name" --https-only true --output none &&
  az webapp config set -g $RG -n "$name" --always-on true --min-tls-version 1.2 --startup-file "node $2" --output none &&
  az resource update -g $RG --name scm --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies \
    --parent "sites/$name" --set properties.allow=true --output none
}
settings() { az webapp config appsettings set -g $RG -n "$P-$1-$S" --output none --settings "${@:2}"; }

for svc in $SERVICES; do
  prepare "$svc" "apps/services/$svc/dist/main.js" &&
  settings "$svc" "${COMMON[@]}" "DATABASE_URL=postgres://$ADMIN:$DBPASS@$DB_HOST:5432/${svc//-/_}" DATABASE_SSL=true DB_POOL_MAX=2 &&
  echo "OK $svc"
done

settings ms-identity "JWT_SECRET=$JWT" "PORTAL_URL=$WEB" && echo "OK ms-identity extra"
settings ms-payment "WEBHOOK_SECRET=$WEBHOOK" "PAYMENT_WEBHOOK_URL=$(url ms-payment)/api/v3/webhooks/simulada" && echo "OK ms-payment extra"
settings ms-booking "VOUCHER_SECRET=$VOUCHER" && echo "OK ms-booking extra"
settings ms-inventory "BOOKING_REST_STOCK_URL=$STOCK_URL" "BOOKING_API_KEY=$STOCK_KEY" && echo "OK ms-inventory extra"

prepare esb apps/esb/dist/main.js &&
settings esb "${COMMON[@]}" ESB_TIMEOUT_FACTOR=3 \
  "IDENTITY_URL=$(url ms-identity)" "LOCATION_URL=$(url ms-location)" "CATALOG_URL=$(url ms-catalog)" "BILLING_URL=$(url ms-billing-profile)" \
  "PRICING_URL=$(url ms-pricing)" "INVENTORY_URL=$(url ms-inventory)" "REVIEW_URL=$(url ms-review)" "COUPON_URL=$(url ms-coupon)" \
  "CART_URL=$(url ms-cart)" "PAYMENT_URL=$(url ms-payment)" "ORDER_URL=$(url ms-order)" "BOOKING_URL=$(url ms-booking)" \
  "REFUND_URL=$(url ms-refund)" "INVOICING_URL=$(url ms-invoicing)" "SUPPORT_URL=$(url ms-support)" "AUDIT_URL=$(url ms-audit)" &&
echo "OK esb"
az webapp config appsettings delete -g $RG -n $P-esb-$S --setting-names BOOKING_GRPC ORDER_GRPC INVENTORY_GRPC PRICING_GRPC --output none

prepare gateway apps/gateway/dist/main.js &&
settings gateway "${COMMON[@]}" "CORS_ORIGINS=$WEB" "GRAPHQL_URL=$(url graphql)" "PARTNER_API_URL=$(url partner-api)" "IDENTITY_URL=$(url ms-identity)" &&
echo "OK gateway"

prepare graphql apps/graphql/dist/main.js && settings graphql "${COMMON[@]}" && echo "OK graphql"

prepare partner-api apps/partner-api/dist/main.js &&
settings partner-api "${COMMON[@]}" "PUBLIC_BASE_URL=$(url gateway)/api/v3" HEALTH_TIMEOUT_MS=4000 HEALTH_UP_MS=1500 HEALTH_DOWN_MS=4500 HEALTH_CACHE_MS=10000 &&
echo "OK partner-api"

echo "=== TERMINADO ==="
