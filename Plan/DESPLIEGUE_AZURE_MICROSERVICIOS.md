# DESPLIEGUE_AZURE_MICROSERVICIOS — Subir Descubre EC a Azure paso a paso

Guía para publicar la arquitectura de microservicios en Azure, con **todos los servicios en App Service** y **RabbitMQ en
CloudAMQP** (plan gratuito Little Lemur). Hay pasos que haces tú en los portales (🧑) y cambios de código que hago yo antes de
desplegar (🤖).

> **Todavía no se puede desplegar completo.** La sección 2 lista lo que falta. Crea los recursos de pago (pasos 3, 4 y 7) cuando esa
> lista esté cerrada, porque cobran desde que existen.

---

## 1. Qué servicio usa cada parte

```mermaid
flowchart LR
  U[Navegador] --> SWA["Portal web<br/>Static Web Apps (Free)"]
  BP[Booking Prototipo] -- "REST + X-API-Key" --> GW
  SWA -- HTTPS --> GW["API Gateway<br/>App Service"]
  GW --> GQL["GraphQL<br/>App Service"]
  GW --> PAPI["Partner API<br/>App Service"]
  GQL --> ESB["ESB<br/>App Service"]
  PAPI --> ESB
  ESB --> REST["Servicios REST<br/>App Service"]
  ESB -- "HTTP + X-Service-Token" --> CORE["Booking · Order · Inventory · Pricing<br/>App Service"]
  CORE -- "REST + X-API-Key (stock)" --> BP
  REST --> DB[("PostgreSQL<br/>Flexible Server")]
  CORE --> DB
  REST <--> MQ["RabbitMQ<br/>CloudAMQP Little Lemur"]
  CORE <--> MQ
  GH[GitHub] -- "GitHub Actions" --> SWA & GW & REST
```

| Parte | Servicio | Plan recomendado | Por qué |
|-------|----------|------------------|---------|
| Portal web | **Azure Static Web Apps** | Free | Archivos estáticos con HTTPS incluido |
| Gateway, GraphQL, Partner API, ESB y servicios REST | **Azure App Service** (Linux, Node 22), un solo plan | **B2** | Son 20 procesos Node. En B1 (1.75 GB) no caben con margen; varias apps comparten el plan sin costo extra |
| RabbitMQ | **CloudAMQP** | Little Lemur (US$0/mes) | No consume RAM de nuestros servidores |
| Bases de datos | **Azure Database for PostgreSQL – Flexible Server** | Burstable **B1ms**, 32 GB | Un servidor con una base por microservicio |
| Redis | Sin Redis al inicio | — | `REDIS_URL` es opcional: sin ella, cada proceso usa caché en memoria |

**Costo aproximado.** Son valores de referencia: confírmalos en la calculadora de Azure antes de crear nada.

| Servicio | Costo |
|----------|-------|
| App Service B2 | ~US$26/mes |
| PostgreSQL B1ms, 32 GB | ~US$33/mes. El portal ofrece 750 horas y 32 GB gratis: si se aplican, US$0 |
| CloudAMQP Little Lemur | US$0 |
| Static Web Apps Free | US$0 |
| **Total** | **~US$59/mes**, o ~US$26/mes con PostgreSQL gratis, más el backend anterior mientras exista |

> **Ahorro:** Azure for Students da **US$100 de crédito**. El plan B2 se puede bajar de nivel después de la evaluación. Crea un
> presupuesto en **Administración de costos** para recibir un aviso antes de agotarlo.

---

## 2. Estado del código para el despliegue

| # | Pendiente | Quién | Por qué bloquea |
|---|-----------|-------|-----------------|
| 1 | Reprogramar **Refund** y **Support**, y programar **ms-invoicing** y **ms-audit** | 🤖 | Aún no existen según su plan |
| 2 | Conectar **ESB, Gateway, Partner API y GraphQL** a los servicios nuevos: rutas `*.*`, `X-Service-Token`, `payload_json`, y principal con el `usu_id` numérico y los roles en `scopes` | 🤖 | Hoy apuntan a los servicios viejos, y por eso nada funciona de punta a punta |
| 3 | Registrar en el ESB las rutas `*.*` de Booking, Order, Inventory y Pricing (`POST /internal/rpc/<Método>`) | 🤖 | El ESB aún tiene las rutas de los servicios viejos |
| 4 | Ejecutar todas las migraciones y una compra completa contra una base real | 🤖 + 🧑 | Hasta ahora el código solo se compiló |
| 5 | Hacer configurable el tamaño del pool de conexiones (`DB_POOL_MAX`) | 🤖 | Hoy es 10 fijo por proceso. Con 20 procesos serían 200 conexiones, muy por encima de lo que admite B1ms |
| 6 | Extender `tools/package-backend.mjs` y crear los workflows nuevos | 🤖 | Hoy solo empaqueta `api` y `auth` |
| 7 | Adaptar `AtraccionesService-web` a las rutas y respuestas v3 | 🤖 | Hoy llama a `/api/v1`, y los servicios nuevos usan `/api/v3` |
| 8 | Cambiar de repositorio y borrar los workflows viejos | 🧑 | Comandos en la sección 3 |
| 9 | Confirmar con Booking la URL del stock: una guía dice `booking-puce.brazilsouth…` y otra `booking-puce.eastus…` | 🧑 | Va en `BOOKING_REST_STOCK_URL` |

---

## 3. Paso a paso (🧑 lo haces tú)

### Paso 0 — Repositorio nuevo de GitHub

Ejecuta en Git Bash, desde la raíz del proyecto. Crea antes un repositorio **vacío** en GitHub.

```bash
git bundle create ../atracciones-respaldo.bundle --all   # respaldo
git status --short | less                                # revisa, sobre todo AtraccionesService-web
git add -A
git commit -m "Microservicios del diseño v2"
git remote remove origin
git rm .github/workflows/deploy-api.yml .github/workflows/deploy-auth.yml
git rm .github/workflows/azure-static-web-apps-red-pebble-08e84d70f.yml
git commit -m "Quitar workflows del despliegue anterior"
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

> Si los borrados del frontend no fueron intencionales, ejecuta `git restore AtraccionesService-web` **antes** de `git add -A`.
> El repositorio anterior y su despliegue siguen funcionando: esto solo quita el vínculo local.

### Paso 1 — Cuenta y región

1. Entra a **https://portal.azure.com** con tu cuenta de Azure for Students.
2. Regiones de esta suscripción de Azure for Students: **App Service en West US 3**, y **PostgreSQL en Brazil South**. Son las opciones con cuota y costo aceptable. Las consultas entre regiones tienen bastante latencia, sobre todo desde la VM.
   En Brazil South, East US 2 y Central US, los planes B1, B2 y B3 tienen cuota 0.
3. **Con otra suscripción, confirma la cuota antes de crear nada de pago.** Puede ser distinta.
   Crea el grupo del paso 2 y, en Cloud Shell, prueba un plan B2 en West US 3 y bórralo enseguida:

   ```bash
   az appservice plan create -g <grupo-de-recursos> -n prueba-b2 --is-linux --sku B2 --location westus3
   az appservice plan delete -g <grupo-de-recursos> -n prueba-b2 -y
   ```

### Paso 2 — Grupo de recursos

1. Buscador → **Grupos de recursos** → **+ Crear**.
2. Nombre: **`rg-descubre-ec`** · Región: **West US 3**.
3. **Revisar y crear** → **Crear**.

### Paso 3 — RabbitMQ en CloudAMQP

1. Crea una cuenta en **https://www.cloudamqp.com**.
2. **Create New Instance**:

   | Campo | Valor |
   |-------|-------|
   | Name | `descubre-ec` |
   | Plan | **Little Lemur (Free)** |
   | Region | la más cercana a West US 3 |

3. Entra a la instancia y copia **AMQP URL** (empieza con `amqps://`). Es tu `RABBITMQ_URL`: no la subas al repositorio.

> Revisa en esa pantalla los límites vigentes del plan, sobre todo el de **conexiones simultáneas**. Son unos 12 procesos con conexión al
> bus: si el plan no alcanza, avísame.

### Paso 4 — PostgreSQL

1. Buscador → **Azure Database for PostgreSQL flexible servers** → **+ Crear**.

> ⚠️ **Cuidado con el costo.** El formulario viene en **Producción** con un servidor de ~USD 275/mes. Cámbialo a **Desarrollo/pruebas**
> y, en **Configurar servidor**, a **Burstable → Standard_B1ms, 32 GiB**. Si el total supera ~USD 35/mes, **no lo crees**.

2. Pestaña **Básico**:

   | Campo | Valor |
   |-------|-------|
   | Nombre del servidor | `descubre-ec-db-<iniciales>` |
   | Región | **Brazil South**: esta suscripción no permite crear B1ms en West US 3 (`SkuNotAvailable`) |
   | Versión de PostgreSQL | **16** |
   | Tipo de carga de trabajo | **Desarrollo** |
   | Método de autenticación | **Solo autenticación de PostgreSQL** |
   | Usuario administrador | `dbadmin` |
   | Contraseña | una segura; guárdala fuera del repositorio |

3. Pestaña **Redes**: **Acceso público**, marca **Permitir el acceso público desde cualquier servicio de Azure** y **+ Agregar dirección
   IP del cliente actual**.
4. **Revisar y crear** → **Crear**.
5. Ya creado: **Configuración → Parámetros del servidor** → busca `azure.extensions` → en la lista de la columna **Valor**, marca **`pgcrypto`**, **`pg_trgm`** y **`btree_gist`** (el portal puede mostrarlas en mayúsculas) → **Guardar**.

> Sin ese paso fallan las migraciones de Identity, Catalog, Pricing y Booking, con un error de extensión no permitida.

### Paso 5 — Crear las bases y aplicar las migraciones

Desde tu PC, con el proyecto compilado:

```powershell
npm run build
$env:SERVICES_DATABASE_URL = "postgres://dbadmin:<contraseña-codificada>@descubre-ec-db-<iniciales>.postgres.database.azure.com:5432/"
$env:DATABASE_SSL = "true"
npm run db:migrate -- ms-identity ms-location ms-billing-profile ms-catalog ms-review ms-pricing ms-inventory ms-cart ms-coupon ms-order ms-booking ms-payment ms-refund ms-invoicing ms-support ms-audit
```

Crea el primer administrador con la misma conexión:

```powershell
$env:DATABASE_URL = "postgres://dbadmin:<contraseña-codificada>@descubre-ec-db-<iniciales>.postgres.database.azure.com:5432/ms_identity"
$env:ADMIN_EMAIL = "correo@ejemplo.com"
$env:ADMIN_PASSWORD = "<contraseña>"
node tools/create-admin.mjs
```

En las URL, codifica los caracteres especiales de la contraseña (por ejemplo, `@` como `%40`).

### Paso 6 — Sin máquina virtual

Las tiendas no necesitan VM: la VM con el puerto 50051 es la del Booking Prototipo, que administra su propio equipo. Booking, Order,
Inventory y Pricing van en App Service (paso 11). Las llamadas internas usan HTTP con TLS y `X-Service-Token`.

### Paso 7 — Plan de App Service y las apps

1. Buscador → **App Services** → **+ Crear** → **Aplicación web**:

   | Campo | Valor |
   |-------|-------|
   | Nombre | `descubre-gateway` |
   | Publicar | **Código** |
   | Pila del entorno de ejecución | **Node 22 LTS** |
   | Sistema operativo | **Linux** |
   | Plan de Linux | **Crear nuevo** → `asp-descubre-ec` |
   | Plan de precios | **Basic B2** |

2. Repite con el **mismo plan** para: `descubre-graphql`, `descubre-partner-api`, `descubre-esb`, `descubre-ms-identity`,
   `descubre-ms-location`, `descubre-ms-billing-profile`, `descubre-ms-catalog`, `descubre-ms-review`, `descubre-ms-cart`,
   `descubre-ms-coupon`, `descubre-ms-payment`, `descubre-ms-refund`, `descubre-ms-invoicing`, `descubre-ms-support` y
   `descubre-ms-audit`.

   Para no repetir el formulario 16 veces, usa **Cloud Shell** en modo Bash. Crea el plan en **West US 3** y agrega un
   sufijo, porque los nombres son únicos en todo Azure:

   ```bash
   RG=<grupo-de-recursos>; PLAN=asp-descubre-ec; SUF=<sufijo>
   az appservice plan create -g $RG -n $PLAN --is-linux --sku B2 --location westus3
   for app in gateway graphql partner-api esb ms-identity ms-location ms-billing-profile ms-catalog ms-review ms-cart ms-coupon ms-payment ms-refund ms-invoicing ms-support ms-audit ms-booking ms-order ms-inventory ms-pricing; do
     az webapp create -g $RG -p $PLAN -n descubre-$app-$SUF --runtime "NODE:22-lts" --output none && \
     az webapp config set -g $RG -n descubre-$app-$SUF --always-on true --output none && \
     echo "OK $app"
   done
   ```

3. Anota el **Dominio predeterminado** exacto de cada una. En Cloud Shell: `az webapp list -g $RG --query "[].{app:name, dominio:defaultHostName}" -o table`.

### Paso 8 — Generar los secretos

Ejecuta este comando una vez por secreto:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Secreto | Dónde va |
|---------|----------|
| `INTERNAL_TOKEN_SECRET` | Todos los servicios y el Gateway: **el mismo** valor |
| `SERVICE_TOKEN` | Todos los servicios, el ESB y el Gateway: **el mismo** valor |
| `JWT_SECRET` | Solo `ms-identity` |
| `WEBHOOK_SECRET` | Solo `ms-payment` |
| `VOUCHER_SECRET` | Solo `ms-booking` |

Van **solo** en la configuración de Azure, nunca en el repositorio.

### Paso 9 — Static Web App

1. Buscador → **Static Web Apps** → **+ Crear**:

   | Campo | Valor |
   |-------|-------|
   | Nombre | `descubre-ec-web` |
   | Tipo de plan | **Free** |
   | Origen de la implementación | **GitHub** → el repositorio nuevo, rama **`main`** |
   | Ubicación de la aplicación |primero escojer react **`/AtraccionesService-web`** |
   | Ubicación de la salida | **`dist`** |

2. Azure crea su workflow en el repositorio. Anota la **URL**.

### Paso 10 — Variables de entorno de cada app

En cada App Service: **Configuración** → **Variables de entorno** → **+ Agregar** → **Aplicar**. Para no hacerlo app por app, usa un script
en Cloud Shell con `az webapp config appsettings set`, que pida los secretos con `read -rs` para no dejarlos escritos.

**Se puede hacer mediante un comando**

**Todas las apps de servicios:**

| Nombre | Valor |
|--------|-------|
| `DATABASE_URL` | `postgres://dbadmin:<contraseña-codificada>@<servidor>.postgres.database.azure.com:5432/<base>` |
| `DATABASE_SSL` | `true` |
| `DB_POOL_MAX` | `3` (cuando exista, pendiente 5 de la sección 2) |
| `RABBITMQ_URL` | la URL `amqps://` del paso 3, en los servicios con eventos |
| `INTERNAL_TOKEN_SECRET` | el del paso 8 |
| `SERVICE_TOKEN` | el del paso 8 |
| `ESB_URL` | la URL de `descubre-esb` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |

**Variables propias:**

| App | Nombre | Valor |
|-----|--------|-------|
| `ms-identity` | `JWT_SECRET` | el del paso 8 |
| `ms-identity` | `PORTAL_URL` | la URL de la Static Web App |
| `ms-payment` | `WEBHOOK_SECRET` | el del paso 8 |
| `ms-payment` | `PAYMENT_WEBHOOK_URL` | `https://<descubre-ms-payment>.azurewebsites.net/api/v3/webhooks/simulada` |
| `esb` | `IDENTITY_URL`, `CATALOG_URL`, `CART_URL`, `PAYMENT_URL`, `INVOICING_URL`, `AUDIT_URL` y los demás REST | la URL de cada app |
| `esb` | `BOOKING_URL`, `ORDER_URL`, `INVENTORY_URL`, `PRICING_URL` | la URL de cada app (paso 11) |
| `gateway` | `CORS_ORIGINS` | la URL de la Static Web App, sin `/` al final |
| `gateway` | `ESB_URL`, `GRAPHQL_URL`, `PARTNER_API_URL`, `IDENTITY_URL` | la URL de cada app |
| `partner-api` | `PUBLIC_BASE_URL` | `https://<descubre-gateway>.azurewebsites.net/api/v3` |

Comando de inicio de cada app: `node apps/services/<servicio>/dist/main.js`, o `node apps/<app>/dist/main.js` para Gateway, GraphQL,
Partner API y ESB. Activa **Siempre activo (Always On)** en todas.

> **No hace falta definir `PORT`:** App Service lo define y los servicios lo leen.

### Paso 11 — Crear y configurar Booking, Order, Inventory y Pricing

Estos cuatro servicios van en App Service como los demás. Exponen cada operación del `.proto` en `POST /internal/rpc/<Método>`, con
`X-Service-Token`, y solo el ESB los llama.

> **¿Es general?** No. Este script es **específico de este despliegue**. Para usarlo en otro, cambia `RG`, `P`, `S`, `PLAN`, `ADMIN` y
> `DB_HOST` en las primeras líneas. Los secretos no están escritos: los pide al ejecutarlo.

Pégalo completo en **Cloud Shell (Bash)**. Se puede repetir sin problema:

```bash
cat > ~/paso11.sh <<'EOF'
RG=rg-tourgirls; P=tourgirls; S=mm; PLAN=asp-tourgirls-michael
ADMIN=touradmin; DB_HOST=tourgirls-db-mms.postgres.database.azure.com

read -rp "Contraseña de $ADMIN (como en la URL): " DBPASS
read -rp 'RABBITMQ_URL: ' RABBIT
read -rp 'INTERNAL_TOKEN_SECRET: ' INTERNAL
read -rp 'SERVICE_TOKEN: ' SVC
read -rp 'VOUCHER_SECRET: ' VOUCHER
read -rp 'BOOKING_REST_STOCK_URL (Enter si aún no se conoce): ' STOCK_URL
read -rp 'BOOKING_API_KEY (Enter si aún no se generó): ' STOCK_KEY

url() { echo "https://$P-$1-$S.azurewebsites.net"; }

for svc in ms-booking ms-order ms-inventory ms-pricing; do
  name=$P-$svc-$S
  if [ -z "$(az webapp list -g $RG --query "[?name=='$name'].name" -o tsv)" ]; then
    az webapp create -g $RG -p $PLAN -n $name --runtime "NODE:22-lts" --output none || continue
  fi
  az webapp update -g $RG -n $name --https-only true --output none && \
  az webapp config set -g $RG -n $name --always-on true --min-tls-version 1.2 --startup-file "node apps/services/$svc/dist/main.js" --output none && \
  az webapp config appsettings set -g $RG -n $name --output none --settings \
    "DATABASE_URL=postgres://$ADMIN:$DBPASS@$DB_HOST:5432/${svc//-/_}" DATABASE_SSL=true DB_POOL_MAX=3 \
    "RABBITMQ_URL=$RABBIT" "INTERNAL_TOKEN_SECRET=$INTERNAL" "SERVICE_TOKEN=$SVC" "ESB_URL=$(url esb)" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false WEBSITES_CONTAINER_START_TIME_LIMIT=600 && \
  echo "OK $svc"
done

az webapp config appsettings set -g $RG -n $P-ms-booking-$S --output none --settings "VOUCHER_SECRET=$VOUCHER" && echo "OK booking extra"
az webapp config appsettings set -g $RG -n $P-ms-inventory-$S --output none --settings "BOOKING_REST_STOCK_URL=$STOCK_URL" "BOOKING_API_KEY=$STOCK_KEY" && echo "OK inventory extra"
az webapp config appsettings set -g $RG -n $P-esb-$S --output none --settings \
  "BOOKING_URL=$(url ms-booking)" "ORDER_URL=$(url ms-order)" "INVENTORY_URL=$(url ms-inventory)" "PRICING_URL=$(url ms-pricing)" && echo "OK esb"
az webapp config appsettings delete -g $RG -n $P-esb-$S --setting-names BOOKING_GRPC ORDER_GRPC INVENTORY_GRPC PRICING_GRPC --output none && echo "OK esb limpio"
echo "=== TERMINADO ==="
EOF
bash ~/paso11.sh
```

Debe mostrar 8 líneas `OK` y `=== TERMINADO ===`. Al final, ejecuta `clear`, porque los valores quedan visibles.

Si dejas vacía `BOOKING_REST_STOCK_URL`, Inventory no envía el stock y lo guarda como pendiente: se entrega cuando la definas. La
`X-API-Key` la generas tú con el comando del paso 8, y se la envías a Booking en la ficha de registro.

### Paso 12 — Pásame estos datos

- [ ] Dominio de cada App Service y URL de la Static Web App.
- [ ] Nombre del servidor PostgreSQL.
- [ ] URL de stock de Booking Prototipo.
- [ ] Confirmación de las variables del paso 10. **Ningún secreto ni contraseña**: van solo en Azure.

---

## 4. Despliegue (🤖 + 🧑)

1. 🤖 Subo a `main` un workflow que compila, arma un paquete por app y lo publica en su App Service.
2. 🧑 Para que GitHub pueda desplegar:
   - en cada App Service → **Información general** → **Descargar perfil de publicación**;
   - en GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, con un secreto por app.
   - Si el botón aparece deshabilitado: **Configuración** → **Configuración general** → activar **Autenticación básica de publicación
     SCM** → Guardar.
3. Cada `push` a `main` despliega las apps. El avance se ve en la pestaña **Actions**.
4. 🧑 Con el Gateway desplegado y el frontend ya en v3 (pendiente 7 de la sección 2), apunta el portal al Gateway. En
   `AtraccionesService-web/.env.production`, usa la URL de `descubre-gateway`, sin prefijo ni `/` final:

   ```ini
   VITE_API_URL=https://<descubre-gateway>.azurewebsites.net
   VITE_AUTH_URL=https://<descubre-gateway>.azurewebsites.net
   ```

   Haz commit y push: el workflow de la Static Web App recompila y publica solo.

---

## 5. Verificación final

| Qué | Cómo | Esperado |
|-----|------|----------|
| Apps vivas | `https://<app>.azurewebsites.net/api/v3/health` | `status: UP` y `database_connected: true` |
| Puerto cerrado | Lo mismo, desde una IP no permitida | Falla |
| RabbitMQ | Panel de CloudAMQP → **RabbitMQ Manager** → **Queues** | Aparecen `ms-catalog`, `ms-order`, `ms-booking` y `ms-payment-webhooks` |
| Migraciones | `SELECT name FROM schema_migrations` en cada base | Una fila por migración |
| Catálogo | `GET /api/v3/atracciones` por el Gateway | Lista paginada |
| Compra aprobada | Compra del portal con tarjeta `ultimos4` distinto de `0000` | `PENDING`, y luego `CONFIRMED` |
| Compra rechazada | `ultimos4 = 0000` | `CANCELLED`, y los cupos vuelven |
| Transferencia | Enviar un comprobante | La pasarela simulada la valida sin intervención humana. Si termina en `0000`, la rechaza |
| Sin cupos | Reservar más que el aforo | `409` con `code: OUT_OF_STOCK` y ninguna orden abierta |
| Idempotencia | Repetir la compra con la misma `Idempotency-Key` | La misma respuesta y una sola reserva |
| Factura | Tras una compra aprobada | Factura `AUTORIZADA` por el SRI simulado |
| Logs | App Service → **Secuencia de registro** | Arranque y errores, con su `correlation_id` |

---

## 6. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El servicio se apaga al arrancar con "debe tener al menos 32 caracteres" | Falta un secreto o es corto | Revisar los pasos 8, 10 y 11 |
| `remaining connection slots are reserved` | Demasiadas conexiones para B1ms | Bajar `DB_POOL_MAX`, o subir el nivel del servidor |
| Error `extension is not allow-listed` en las migraciones | Falta `azure.extensions` | Paso 4.5 |
| El ESB responde `503` hacia Booking, Order o Inventory | Regla de red, o IP de salida del App Service que cambió | Revisar `BOOKING_URL`, `ORDER_URL` e `INVENTORY_URL` y el `SERVICE_TOKEN` |
| `401` en `/internal/**` | `SERVICE_TOKEN` distinto entre componentes | Debe ser idéntico en todos |
| `403` en rutas de usuario | El principal no trae el `usu_id` numérico ni los roles | Pendiente 2 de la sección 2 |
| Los precios o calificaciones no llegan a Catalog | Servicio sin `RABBITMQ_URL`: usa un bus en memoria y no avisa a los demás | Definirla en **todos** los servicios con eventos |
| Conexiones rechazadas en CloudAMQP | Se alcanzó el límite del plan | Revisar el panel de CloudAMQP y avisarme |
| Un pago queda `PENDIENTE` | `PAYMENT_WEBHOOK_URL` o `WEBHOOK_SECRET` mal puestos | Revisar el log de `ms-payment`; Order cancela la orden a los 30 minutos |
| La primera petición tarda ~20 s | Falta Always On | Activarlo en cada app |
| El crédito baja rápido | PostgreSQL y el backend anterior siguen encendidos | Detener lo que no se use |
