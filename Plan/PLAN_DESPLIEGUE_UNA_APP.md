# Guía · TourGirls en una sola App Service

| | |
|---|---|
| Objetivo | Desplegar como pide `GUIA_SOCIOS_AZURE_APP_SERVICE(1).md`: **una** App Service Linux B1, en lugar de 20 apps en B2 |
| Motivo | Con 20 apps, el plan B2 quedó al 85–93 % de memoria y los despliegues se colgaban (Kudu en 503) |
| Qué no cambia | Los 16 microservicios, sus bases, el ESB interno, el Gateway, GraphQL, la Partner API, los contratos y la URL pública |
| Reemplaza a | `Plan/DESPLIEGUE_AZURE_MICROSERVICIOS.md` (despliegue de 20 apps) |
| Quién hace qué | 🧑 tú, en Azure y en la terminal · 🤖 yo, el código y los comandos |
| Estado (2026-10-31) | Parte 2 programada: compila y el paquete incluye el lanzador. Aún sin ejecutar en Azure |

> Proyecto educativo interno: las URL y claves van escritas tal cual en esta guía.

---

## Parte 1 · Borrar el despliegue actual (🧑)

Quita todo lo que cobra y ya no se usa. **Se conserva la base de datos** `tourgirls-db-mms`: tiene las 16 bases `ms_*` con sus
migraciones, el administrador, la X-API-Key y las atracciones creadas, y el despliegue nuevo la reutiliza. Está en el mismo grupo
`rg-tourgirls`, así que **nunca borres el grupo completo**: se borra recurso por recurso.

Todo se ejecuta en **Cloud Shell (Bash)**.

**1.1 Detener los despliegues automáticos** (si no, cada `push` intenta publicar en apps que ya no existen)

```bash
gh auth status || gh auth login
REPO=GlieseKep/Atracciones-Entrega-2-Microservicios
for id in $(gh run list -R $REPO -w "Desplegar microservicios en Azure" -s in_progress --json databaseId -q '.[].databaseId'); do gh run cancel $id -R $REPO; done
gh workflow disable deploy-microservices.yml -R $REPO
```

**1.2 Borrar las 20 apps y el plan B2**

```bash
RG=rg-tourgirls
for app in $(az webapp list -g $RG --query "[].name" -o tsv); do
  az webapp delete -g $RG -n $app --keep-empty-plan && echo "borrada $app"
done
az appservice plan delete -g $RG -n asp-tourgirls-michael -y && echo "plan borrado"
```

**1.3 Borrar la VM y lo que creó con ella** (disco, interfaz de red, IP pública, grupo de seguridad y red virtual)

```bash
az vm delete -g $RG -n vm-booking-mmolina -y
for tipo in Microsoft.Compute/disks Microsoft.Network/networkInterfaces Microsoft.Network/publicIPAddresses Microsoft.Network/networkSecurityGroups Microsoft.Network/virtualNetworks Microsoft.Compute/sshPublicKeys; do
  for id in $(az resource list -g $RG --resource-type $tipo --query "[].id" -o tsv); do
    az resource delete --ids $id && echo "borrado $(basename $id)"
  done
done
```

**1.4 Borrar el backend anterior** (grupo `Atracciones-MMS`: plan, `tourgirls-api-mms`, `tourgirls-auth-mms` y el portal viejo)

Primero comprueba que **no** tenga ningún servidor PostgreSQL (la base ya se movió a `rg-tourgirls`):

```bash
az resource list -g Atracciones-MMS --query "[].{nombre:name, tipo:type}" -o table
```

Si en la lista **no** aparece `Microsoft.DBforPostgreSQL/flexibleServers`, bórralo completo:

```bash
az group delete -n Atracciones-MMS -y --no-wait && echo "borrando Atracciones-MMS"
```

**1.5 Detener la base mientras no hay app** (no se borra; detenida no cobra cómputo)

```bash
az postgres flexible-server stop -g $RG -n tourgirls-db-mms
```

Azure la vuelve a encender sola a los 7 días. La Parte 3 la arranca de nuevo.

**1.6 Limpiar GitHub** (los 20 perfiles de publicación ya no sirven)

```bash
for s in $(gh secret list -R $REPO --json name -q '.[].name | select(startswith("AZURE_PUBLISH_"))'); do
  gh secret delete $s -R $REPO && echo "borrado $s"
done
gh variable delete AZURE_APP_PREFIX -R $REPO; gh variable delete AZURE_APP_SUFFIX -R $REPO
```

**1.7 Otros**

- **Instancia propia de CloudAMQP** (`guppy.rmq6.cloudamqp.com`): ya no se usa. Bórrala en el panel de CloudAMQP (es gratis,
  pero no hace falta).
- **Static Web App** (`nice-bay-0fae5090f`): es gratis y es el portal, **se conserva**.
- `NetworkWatcherRG` y `DefaultResourceGroup-CQ`: los crea Azure y no cobran.

**1.8 Comprobar**

```bash
az resource list -g $RG --query "[].{nombre:name, tipo:type, region:location}" -o table
```

Solo debe quedar `tourgirls-db-mms` (y, si existe, la Static Web App).

---

## Parte 2 · Lo que se programa para alinearse con la guía (🤖)

Cada servicio sigue siendo un **proceso Node independiente**, con su base, su puerto y su contrato. Lo que cambia es que los 20
procesos corren dentro del **mismo contenedor**: un lanzador los arranca, les da su puerto y su base, y reinicia el que se caiga.
Solo el Gateway queda expuesto a internet; los demás se hablan por `localhost`.

```
App Service: tourgirls-gateway-mm (B1, West US 3)
└─ lanzador (node tools/launcher.mjs)
   ├─ gateway        :$PORT  ← único puerto público
   ├─ partner-api    :3100
   ├─ graphql        :3200
   ├─ esb            :3300
   └─ 16 servicios   :4011–4026  (ms-identity :4018, ms-catalog :4019, …)
```

| | Antes (20 apps) | Una app |
|---|---|---|
| Plan | B2 (~US$26/mes) | B1 (~US$13/mes) |
| Memoria estimada | 3–3,3 GB | 1,6–1,8 GB |
| Contenedores y Kudu | 20 | 1 |
| Subidas por despliegue | 20 | 1 |
| Llamadas entre servicios | Por internet, con TLS | Por `localhost` |
| Si se cae el contenedor | Cae una app | Caen todos |

### 2.1 Lanzador `tools/launcher.mjs`

- [x] Arranca los 20 `main.js` con `child_process.fork`, cada uno con su propio entorno.
- [x] **Puerto:** el Gateway usa el `PORT` de App Service; a los demás les asigna su puerto local.
- [x] **Base de datos:** una sola variable `DATABASE_SERVER_URL` (sin nombre de base). El lanzador agrega `/ms_identity`,
      `/ms_catalog`, … con la misma regla de `tools/migrate-services.mjs`.
- [x] **URL internas** en `localhost`: `ESB_URL`, `IDENTITY_URL`, `CATALOG_URL`, …, `PARTNER_API_URL`, `GRAPHQL_URL` y
      `PAYMENT_WEBHOOK_URL=http://127.0.0.1:4020/api/v3/webhooks/simulada` (la pasarela simulada llama a ms-payment por dentro).
- [x] **Identidad del nodo:** `NODE_ID=node-atr-molina-01` y `NODE_CODE=NODE_ATR_MOLINA` solo para la Partner API.
- [x] **Reinicio:** si un proceso termina, se reinicia con espera creciente (1 s, 2 s, 4 s… hasta 30 s) y queda en el log.
- [x] **Orden de arranque:** primero los 16 servicios, después ESB, Partner API, GraphQL y al final el Gateway, para que App
      Service solo vea el puerto abierto cuando lo demás ya está arriba.
- [x] **Apagado:** reenvía `SIGTERM` a todos los procesos.
- [x] **Memoria:** `--max-old-space-size=128` por proceso; GraphQL y la Partner API, 192.
- [x] **Logs:** antepone el nombre del servicio a cada línea.

### 2.2 Empaquetado y workflow

- [x] `tools/package-microservices.mjs`: incluir `tools/launcher.mjs` y el SRI simulado (`apps/sri-mock`, puerto 4091), así las facturas se autorizan.
- [x] Workflow nuevo `.github/workflows/deploy-azure.yml` (nombre que pide la guía): compila, empaqueta y publica **una vez** en
      `tourgirls-gateway-mm` con el secreto `AZURE_WEBAPP_PUBLISH_PROFILE`. Se borra `deploy-microservices.yml`.

### 2.3 Configuración de Azure

- [x] `tools/azure-configurar-app-unica.sh`: crea el plan B1 y la app si no existen, y aplica Always On, HTTPS, TLS 1.2,
      health check, comando de inicio y las variables de la Parte 3, paso 3.3.
- [x] Marcar `tools/azure-configurar-apps.sh` y `Plan/DESPLIEGUE_AZURE_MICROSERVICIOS.md` como obsoletos.

### 2.4 Se revisa, pero no debería cambiar

- [ ] Conexiones a PostgreSQL: 16 × `DB_POOL_MAX=2` = 32 (límite de B1ms: 50).
- [ ] Conexiones a RabbitMQ: 12, una por proceso con eventos.
- [ ] Migraciones al arrancar: cada servicio aplica las suyas, como hasta ahora.

---

## Parte 3 · Pasos de la guía de socios, adaptados (🧑, con comandos 🤖)

La guía pide un agente con `az` instalado en tu PC. Aquí se usa **Cloud Shell**, que ya tiene `az` y `gh` con tu sesión.

### Paso 1 · Suscripción y región (Parte 1 de la guía)

Ya hecho: Azure for Students, y la región con cuota para App Service es **West US 3**. La base queda en **Brazil South**.

```bash
az account show --query "{suscripcion:name, estado:state}" -o table
az provider register --namespace Microsoft.Web
```

### Paso 2 · Encender la base

```bash
az postgres flexible-server start -g rg-tourgirls -n tourgirls-db-mms
```

### Paso 3 · Crear y configurar la App Service (reglas 1 a 4 de la guía)

En este paso se crean **dos recursos** en `rg-tourgirls`: el **plan** (la máquina que paga y da la memoria) y la **app** (donde
corre nuestro código). Todo lo hace un solo script; los apartados 3.3 y 3.4 explican qué deja configurado.

**3.1 Bajar el repositorio en Cloud Shell** (cuando el script de la Parte 2.3 ya esté en GitHub)

```bash
gh repo clone GlieseKep/Atracciones-Entrega-2-Microservicios ~/repo 2>/dev/null || (cd ~/repo && git pull -q)
ls ~/repo/tools/azure-configurar-app-unica.sh
```

Si `ls` dice `No such file`, el script aún no está subido: espera a que termine la Parte 2.

**3.2 Ejecutar el script**

```bash
bash ~/repo/tools/azure-configurar-app-unica.sh
```

Te pide, uno por uno, estos datos (pega y pulsa Enter):

| Pregunta | Qué pegar |
|---|---|
| Contraseña de `touradmin` | La de la base `tourgirls-db-mms` (la que funcionó en `DATABASE_URL`) |
| `INTERNAL_TOKEN_SECRET`, `SERVICE_TOKEN`, `JWT_SECRET`, `WEBHOOK_SECRET`, `VOUCHER_SECRET` | Los 5 secretos que generaste |
| `BOOKING_API_KEY` | La `X-API-Key` que enviaste en la ficha |

Debe terminar con `=== TERMINADO ===`. Tarda unos 2 minutos.

**3.3 Lo que crea: el plan y la app**

| Recurso | Nombre | Configuración |
|---|---|---|
| **Plan** de App Service | `asp-tourgirls-b1` | Linux, **B1** (1,75 GB), región **West US 3** |
| **App** (Web App) | `tourgirls-gateway-mm` | Node 22 LTS, dentro del plan anterior. Es la misma URL que ya tiene Booking |

**3.4 Lo que configura en la app `tourgirls-gateway-mm`**

En el portal se ve en la app → **Configuración → Configuración general**:

| Opción del portal | Valor | Regla de la guía |
|---|---|---|
| Siempre activo (Always On) | Activado | 3 · que la app no se duerma |
| Solo HTTPS | Activado | 3 · redirección obligatoria a HTTPS |
| Versión mínima de TLS | 1.2 | 3 · TLS 1.2 mínimo |
| Comando de inicio | `node tools/launcher.mjs` | Arranca los 20 procesos |
| Credenciales de publicación básica de SCM | Activadas | 6 · para descargar el perfil de publicación |

Y en **Supervisión → Comprobación de estado**:

| Opción | Valor |
|---|---|
| Comprobación de estado | Activada, ruta `/health` |

**3.5 Lo que carga en las variables de entorno de la app**

En el portal se ve en la app → **Configuración → Variables de entorno → Configuración de la aplicación**. Son las que leen
nuestros servicios al arrancar (regla 4 de la guía):

| Variable | Valor | Para qué sirve |
|---|---|---|
| `DATABASE_SERVER_URL` | `postgres://touradmin:<contraseña>@tourgirls-db-mms.postgres.database.azure.com:5432` | Servidor PostgreSQL; el lanzador agrega la base de cada servicio |
| `DATABASE_SSL` | `true` | Azure PostgreSQL exige TLS |
| `DB_POOL_MAX` | `2` | Conexiones por servicio (16 × 2 = 32 de 50) |
| `RABBITMQ_URL` | `amqps://qkvqjvku:ATBxToI1JvR6YbRBIIAnATa5mnjdIqz_@shark.rmq.cloudamqp.com/qkvqjvku` | Broker central de la clase |
| `RABBITMQ_EXCHANGE` | `booking.events` | Exchange que pide Booking |
| `RABBITMQ_PREFIX` | `tourgirls` | Nuestras claves y colas: `tourgirls.*` |
| `BOOKING_REST_STOCK_URL` | `https://booking-puce.eastus.cloudapp.azure.com/api/v3/inventory/stock` | Envío de stock a Booking (opción A de la guía) |
| `BOOKING_GRPC_URL` | `booking-puce.eastus.cloudapp.azure.com:50051` | Informativo: el stock va por REST |
| `BOOKING_API_KEY` | La `X-API-Key` de la ficha | Cabecera del envío de stock |
| `INTERNAL_TOKEN_SECRET`, `SERVICE_TOKEN`, `JWT_SECRET`, `WEBHOOK_SECRET`, `VOUCHER_SECRET` | Los 5 secretos | Firmas internas, tokens y vouchers |
| `PORTAL_URL` y `CORS_ORIGINS` | `https://nice-bay-0fae5090f.3.azurestaticapps.net` | Portal web que puede llamar al Gateway |
| `PUBLIC_BASE_URL` | `https://tourgirls-gateway-mm.azurewebsites.net/api/v3` | Enlaces y salud que ve Booking |
| `ESB_TIMEOUT_FACTOR` | `3` | Plazos más largos por la base en otra región |
| `HEALTH_TIMEOUT_MS`, `HEALTH_UP_MS`, `HEALTH_DOWN_MS`, `HEALTH_CACHE_MS` | `4000`, `1500`, `4500`, `10000` | Semáforo de salud para Booking |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | El código llega compilado (regla 3) |
| `WEBSITES_CONTAINER_START_TIME_LIMIT` | `600` | Margen para arrancar los 20 procesos (regla 3) |

**3.6 Comprobar** que el plan y la app quedaron bien:

```bash
az appservice plan show -g rg-tourgirls -n asp-tourgirls-b1 --query "{plan:name, sku:sku.name, region:location}" -o table
az webapp show -g rg-tourgirls -n tourgirls-gateway-mm --query "{app:name, estado:state, httpsOnly:httpsOnly, dominio:defaultHostName}" -o table
az webapp config show -g rg-tourgirls -n tourgirls-gateway-mm --query "{alwaysOn:alwaysOn, tls:minTlsVersion, inicio:appCommandLine, health:healthCheckPath}" -o table
```

Debe mostrar `B1`, `West US 3`, `Running`, `True`, `1.2`, `node tools/launcher.mjs` y `/health`.

### Paso 4 · Publicar el código con GitHub Actions (reglas 5 y 6 de la guía)

**4.1 Guardar el perfil de publicación en GitHub** (secreto `AZURE_WEBAPP_PUBLISH_PROFILE`, como pide la guía)

```bash
REPO=GlieseKep/Atracciones-Entrega-2-Microservicios
az webapp deployment list-publishing-profiles -g rg-tourgirls -n tourgirls-gateway-mm --xml | gh secret set AZURE_WEBAPP_PUBLISH_PROFILE -R $REPO
gh secret list -R $REPO | grep AZURE_WEBAPP_PUBLISH_PROFILE
```

**4.2 Lanzar el despliegue y seguirlo**

```bash
gh workflow enable deploy-azure.yml -R $REPO
gh workflow run deploy-azure.yml -R $REPO
sleep 20
gh run watch -R $REPO
```

Debe terminar con `completed with 'success'`. Son dos trabajos: `build` (compila y arma el `.zip` en Linux, unos 2 min) y
`deploy` (lo sube a la app, unos 3–5 min). Mientras corre, **no cambies la configuración de la app**: reiniciarla corta la subida.

**4.3 Si falla**, ver el error:

```bash
gh run view -R $REPO --log-failed | grep -E "##\[error\]" | head -10
```

### Paso 5 · Comprobar que todo arrancó (regla 7 de la guía)

**5.1 Esperar el arranque.** Los 20 procesos tardan 1–3 minutos en levantarse. Espera y comprueba el estado:

```bash
sleep 120
az webapp show -g rg-tourgirls -n tourgirls-gateway-mm --query state -o tsv
```

**5.2 Probar las rutas públicas**

```bash
G=https://tourgirls-gateway-mm.azurewebsites.net
for p in /health /api/v3/health /api/v3/atracciones/health /api/v3/atracciones; do
  echo "== $p"; curl -s -m 120 -w '\nHTTP %{http_code}\n' "$G$p" | tail -c 400
done
```

| Ruta | Resultado esperado |
|---|---|
| `/health` | `HTTP 200`, `{"status":"UP","service":"gateway"}` |
| `/api/v3/health` y `/api/v3/atracciones/health` | `HTTP 200`, `status` `UP` o `DEGRADED`, `database_connected: true`, `service: "Atracciones"` |
| `/api/v3/atracciones` | `HTTP 200`, un arreglo (vacío `[]` hasta el Paso 6) |

**5.3 Si alguna falla**, ver qué proceso no arrancó en el log de la app:

```bash
az webapp log config -g rg-tourgirls -n tourgirls-gateway-mm --docker-container-logging filesystem --output none
az webapp log download -g rg-tourgirls -n tourgirls-gateway-mm --log-file app.zip
unzip -p app.zip $(unzip -l app.zip | grep -oE "LogFiles/[^ ]*default_docker\.log" | sort | tail -1) | grep -aiE "error|reinicia|exit" | tail -20
```

Cada línea empieza con el nombre del servicio (`[ms-catalog]`, `[esb]`…), así se sabe cuál falla.

### Paso 6 · Cargar el catálogo

**6.1 Instalar dependencias del repositorio** en Cloud Shell:

```bash
cd ~/repo && git pull -q && npm ci --silent
```

**6.2 Ejecutar la carga** (cambia `<contraseña>` por la de `touradmin`):

```bash
LOCATION_DATABASE_URL='postgres://touradmin:<contraseña>@tourgirls-db-mms.postgres.database.azure.com:5432/ms_location' \
node tools/seed-atracciones.mjs
```

Pide el correo y la contraseña del ADMIN (`mdmolinas@ejemplo.com`). Debe mostrar `Atracciones ya existentes: 18` al inicio y
terminar en `=== 18 de 18 atracciones publicadas ===`.

**6.3 Comprobar:**

```bash
curl -s -m 120 https://tourgirls-gateway-mm.azurewebsites.net/api/v3/atracciones | jq 'length, .[0]'
```

Debe mostrar `18` y la primera atracción con `id`, `nombre`, `precio`, `ciudad`, `duracion` y `horarios`.

### Paso 7 · Reporte a Booking

**7.1 Obtener los datos del reporte:**

```bash
G=https://tourgirls-gateway-mm.azurewebsites.net/api/v3
echo "Cantidad: $(curl -s -m 120 $G/atracciones | jq length)"
ID=$(curl -s -m 120 $G/atracciones | jq -r '.[0].id'); echo "ID: $ID"
F=$(date -d '+3 days' +%F)
curl -s -m 120 "$G/atracciones/$ID/disponibilidad?date=$F" | jq -r --arg f "$F" '"Fecha: \($f)  Turno: \(.time_slots[0].slot_id)  Hora: \(.time_slots[0].time)"'
```

**7.2 Completar y enviar a Paúl:**

```
📋 REPORTE DE RESOLUCIÓN - TOURGIRLS (NODE_ATR_MOLINA)
1. Atracciones en GET /api/v3/atracciones: <Cantidad>
2. POST /api/v3/atracciones/reservas acepta atraccion_id o attraction_id con Idempotency-Key: SÍ
3. Broker actualizado a shark.rmq.cloudamqp.com (exchange booking.events, claves tourgirls.booking.*): SÍ
4. Atracción de prueba: <ID> · <Fecha> · <Turno y hora>
URL base: https://tourgirls-gateway-mm.azurewebsites.net/api/v3
Health:   https://tourgirls-gateway-mm.azurewebsites.net/api/v3/atracciones/health
```

### Paso 8 · Vigilar la memoria del plan

**8.1 Medir** las últimas horas (bloques de 5 minutos):

```bash
az monitor metrics list --resource $(az appservice plan show -g rg-tourgirls -n asp-tourgirls-b1 --query id -o tsv) \
  --metric MemoryPercentage --interval PT5M --query "value[0].timeseries[0].data[-12:].average" -o tsv
```

**8.2 Decidir:**

| Memoria sostenida | Qué hacer |
|---|---|
| Menos de 80 % | Nada: B1 alcanza |
| 80–90 % | Vigilar; los despliegues pueden tardar más |
| Más de 90 % o reinicios en el log | Subir a B2: `az appservice plan update -g rg-tourgirls -n asp-tourgirls-b1 --sku B2` |

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un proceso consume demasiada memoria y tumba el contenedor | Límite por proceso y reinicio individual en el lanzador |
| Arrancar los 20 procesos tarda más que el límite de App Service | `WEBSITES_CONTAINER_START_TIME_LIMIT=600` y el Gateway abre su puerto al final |
| El nombre `tourgirls-gateway-mm` no queda libre enseguida tras borrarlo | Esperar unos minutos y repetir; si no, usar otro nombre y avisar a Booking de la URL nueva |
| El docente espera un despliegue por microservicio | Siguen siendo 16 procesos, bases y contratos separados. Confirmarlo antes de la entrega |
| La base sigue en otra región (Brazil South) | Latencia mayor y salud en `DEGRADED`; no bloquea a Booking |
