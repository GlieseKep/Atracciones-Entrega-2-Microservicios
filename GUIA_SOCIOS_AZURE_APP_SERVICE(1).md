# Guía Oficial de Despliegue en Azure App Service para Tiendas Socias

> **Para los equipos:** Ariel Chacha, Alisson Basantes, Dilan Mendoza, Gloria Chushig, Mateo Morales, Michael Molina.  
> **Destino:** Azure App Service Linux (Plan B1 con Azure for Students).  
> **Integración con Orquestador:** Booking Prototipo (Paúl Rosero).

---

## 📌 ¿Por qué Azure App Service es la mejor opción para tu Tienda?

A diferencia de Booking (que actúa como servidor central y orquestador), **tu microservicio de Atracciones o Autos es una tienda proveedora**:
1. Tu servidor solo necesita responder peticiones **HTTP REST** (catálogo de tours o autos, reservas y health check).
2. Para reportar cambios de stock a Booking, tu microservicio actúa como **cliente saliente** (vía HTTP REST hacia `/api/v3/inventory/stock` o gRPC hacia `50051`).
3. **Azure App Service Linux B1** te da:
   - Dominio HTTPS gratuito inmediato (`https://<tu-app>.azurewebsites.net`).
   - Certificado SSL automático sin configurar Nginx ni Caddy.
   - Despliegue continuo con GitHub Actions en cada `git push main`.
   - Costo cubierto al 100% por los $100 USD de crédito de **Azure for Students**.

---

## 🚀 Parte 1: Pasos Previos que debes hacer tú a mano (5 minutos)

### 1. Activar tu suscripción estudiantil
Ingresa a [https://azure.microsoft.com/free/students](https://azure.microsoft.com/free/students) con tu correo institucional PUCE (`@puce.edu.ec`). Te otorgará $100 USD de crédito activo.

### 2. Instalar la CLI de Azure en tu computadora
En una ventana de PowerShell ejecuta:
```powershell
winget install Microsoft.AzureCLI
```
*Cierra y vuelve a abrir tu terminal para que reconozca el comando `az`.*

### 3. Iniciar sesión en Azure
```powershell
az login
```
Se abrirá tu navegador. Inicia sesión con tu correo PUCE. En la lista de suscripciones que aparezca en la consola, elige el número correspondiente a **Azure for Students**.

---

## 🤖 Parte 2: Prompt Estandarizado para tu Agente de IA

> Copia todo el bloque a continuación, personaliza los campos entre `< >` con los datos de tu equipo, y entrégaselo a tu agente (Claude Code, Cursor, Copilot, ChatGPT o Gemini):

```markdown
Hola. Necesito que despliegues el backend de este repositorio en Azure App Service Linux (Plan B1), configurando CI/CD automático con GitHub Actions.

Ya tengo la sesión iniciada en Azure CLI con la suscripción "Azure for Students".

---
### DATOS DEL PROYECTO:
- Nombre deseado de la aplicación en Azure: <ejemplo: alisson-atracciones-api / mateo-autos-api>
- Vertical del microservicio: <ATRACCIONES o AUTOS>
- Integrantes del equipo: <Nombre y Apellido>
- Puerto interno donde escucha el servidor: process.env.PORT || 3000 (y 0.0.0.0)
---

### REGLAS DE DESPLIEGUE EN AZURE APP SERVICE:
1. **Región y Proveedor:**
   - Verifica las regiones permitidas en mi suscripción de estudiante usando `az policy assignment list`.
   - Utiliza una región cercana a la base de datos (por ejemplo: `eastus` o `brazilsouth`).
   - Registra el proveedor de recursos `az provider register --namespace Microsoft.Web`.

2. **Creación de Recursos en Azure:**
   - Crea un Grupo de Recursos: `rg-<nombre-app>`.
   - Crea un App Service Plan Linux con SKU **B1** (el plan B1 es necesario para habilitar "Always On" y evitar que la app se duerma).
   - Crea la Web App (`az webapp create`) con el runtime correspondiente (Node.js 20 o 22 LTS / Python 3.11).

3. **Configuración de Rendimiento y Red:**
   - Activa `always-on = true`.
   - Configura TLS 1.2 mínimo (`--min-tls-version 1.2`).
   - Activa redirección obligatoria a HTTPS (`--https-only true`).
   - Configura el health check apuntando a la ruta de salud de la app (`/api/v3/health` o `/health`).
   - Variables de configuración requeridas en la app:
     * `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (compilamos el bundle antes de subir).
     * `WEBSITES_CONTAINER_START_TIME_LIMIT=600` (evita timeout en el arranque inicial).

4. **Variables de Entorno y Secretos:**
   - NO me pidas contraseñas de bases de datos por el chat. Indícame la lista exacta de variables que mi app necesita (por ejemplo: `DATABASE_URL`, `BOOKING_API_KEY`, `SUPABASE_KEY`) para que yo las cargue en: Portal de Azure → App Service → Configuración → Variables de entorno.
   - Configura en las variables de entorno la conexión con Booking:
     * `BOOKING_REST_STOCK_URL=https://booking-puce.eastus.cloudapp.azure.com/api/v3/inventory/stock`
     * `BOOKING_GRPC_URL=booking-puce.eastus.cloudapp.azure.com:50051`

5. **Empaquetado y Primer Despliegue (Cuidado con Windows):**
   - En Windows NO uses `Compress-Archive` de PowerShell porque introduce barras invertidas (`\`) que dañan el zip en Linux.
   - Usa un script de Python (`zipfile`) o Git Bash para crear el archivo `.zip` que incluya:
     * El directorio compilado (`dist/` o `build/`).
     * `package.json` y `node_modules` de producción (`npm prune --omit=dev`).
     * Archivos de contratos (`openapi.yaml`, esquemas JSON, o `.proto` si aplican).
   - Despliega usando: `az webapp deploy --resource-group <rg> --name <app> --src-path deploy.zip --type zip --async true`.
   - Monitorea el log con `az webapp log download` o `az webapp log tail` hasta confirmar que arranque en el puerto asignado por Azure.

6. **Automatización con GitHub Actions:**
   - Habilita la autenticación básica de publicación:
     `az resource update --resource-group <rg> --name basicPublishingCredentialsPolicies/scm --resource-type "Microsoft.Web/sites/config" --set properties.allow=true`
   - Descarga el perfil de publicación:
     `az webapp deployment list-publishing-profiles --name <app> --resource-group <rg> --xml > publish_profile.xml`
   - Indícame que cree el secreto `AZURE_WEBAPP_PUBLISH_PROFILE` en mi repositorio de GitHub con ese contenido XML.
   - Genera el workflow en `.github/workflows/deploy-azure.yml` para compilar y desplegar con `azure/webapps-deploy@v3` en cada `git push origin main`.

7. **Validación Final:**
   - Ejecuta un curl a `https://<nombre-app>.azurewebsites.net/<ruta-health>` y confirma que responda `HTTP 200` y `status: UP`.
```

---

## 📋 Parte 3: Contratos que tu API debe cumplir para Booking

Booking (Paúl Rosero) se integrará automáticamente con tu URL en Azure. Asegúrate de que tu backend cumpla con estos endpoints:

### Si tu microservicio es de ATRACCIONES:
1. **Health Check:** `GET /api/v3/atracciones/health` (o `/health` o `/api/v2/atracciones/health`)
   - **Respuesta 200 requerida:**
     ```json
     {
       "status": "UP",
       "database_connected": true,
       "service": "Atracciones"
     }
     ```
2. **Catálogo de Tours:** `GET /api/v3/atracciones` (o `/api/v2/...`)
   - **Respuesta 200 requerida:** Array de objetos con al menos:
     `id`, `nombre` (o `titulo`), `precio`, `ciudad` (o `ubicacion`), `duracion`, `horarios`.
3. **Creación de Reservas:** `POST /api/v3/atracciones/reservas` (o `/reservations`)

---

### Si tu microservicio es de AUTOS:
1. **Health Check:** `GET /api/v3/autos/health` (o `/health` o `/api/v3/health`)
   - **Respuesta 200 requerida:**
     ```json
     {
       "status": "UP",
       "database_connected": true,
       "service": "Autos"
     }
     ```
2. **Flota de Vehículos:** `GET /api/v3/autos/flota` o `GET /api/v3/autos`
   - **Respuesta 200 requerida:** Array de vehículos con al menos:
     `id`, `marca`, `modelo`, `categoria` (`ECONOMICO`, `COMPACTO`, `SUV`, `PREMIUM`, `VAN`), `precio_diario`, `estado_operativo` (`DISPONIBLE`).
3. **Creación de Reservas:** `POST /api/v3/autos/reservas` (o `/orders/create`)

---

## 🔄 Parte 4: Cómo reportar tus cambios de stock a Booking

Cuando se confirme o cancele una reserva en tu tienda, debes notificar el stock a Booking por cualquiera de estos dos canales:

### Opción A (Recomendada en Azure): HTTP REST Fallback
- **Método y URL:** `POST https://booking-puce.eastus.cloudapp.azure.com/api/v3/inventory/stock`
- **Headers:**
  - `Content-Type: application/json`
  - `X-API-Key: <TU_API_KEY_REGISTRADA>`
- **Cuerpo JSON:**
  ```json
  {
    "item_id": "auto-001",
    "available_units": 4,
    "date": "2026-10-28",
    "time_slot": "DEFAULT",
    "timestamp": 1793202416000
  }
  ```
- **Respuesta de Booking:** `200 OK` con `{ "acknowledged": true, "success": true, "source": "HTTP_REST" }`.

### Opción B: Cliente gRPC Saliente
- **Host y Puerto:** `booking-puce.eastus.cloudapp.azure.com:50051`
- **Servicio:** `inventory.InventoryService/UpdateStock`
- **Metadata:** `x-api-key: <TU_API_KEY_REGISTRADA>`

---

## ⚠️ Checklist de Errores Frecuentes y Soluciones

1. **Error 503 / 500 en la base de datos (Supabase):**
   - Si estás desarrollando conectado al Wi-Fi de la universidad (PUCE), el firewall institucional bloquea las conexiones directas a los puertos de PostgreSQL (puerto `5432` o `6543`).
   - **Solución:** En Azure App Service la base de datos conectará al instante sin bloqueos. Para pruebas locales antes de subir, usa datos móviles o una VPN.
2. **La app se apaga o responde lenta después de unos minutos:**
   - Ocurre si usaste el plan gratuito `F1`.
   - **Solución:** Usa el plan `B1 Linux` y asegúrate de activar `Always On: true` en la configuración.
3. **Fallo de zip en Windows:**
   - `Compress-Archive` de PowerShell guarda los separadores de ruta como `\`. En el contenedor Linux de Azure, Node no encuentra los archivos.
   - **Solución:** Deja que el agente use el script Python `zipfile` para empaquetar con separadores `/`.

---

## 📬 Ficha de Registro para Enviar a Paúl (Booking)

Una vez que tu agente termine el despliegue y tu health check responda 200, envíale estos datos a Paúl para registrar tu nodo en Booking:

```text
Nombre del sistema: <Tu Tienda>
Integrantes: <Nombres>
Categoría: <Atracciones o Autos>
URL Base REST en Azure: https://<tu-app>.azurewebsites.net/api/v3
Ruta de Health Check: https://<tu-app>.azurewebsites.net/api/v3/health
X-API-Key (si aplica): <tu-clave>
```
Con esto, Paúl agregará tu nodo al Panel 1 y Panel 2 de Booking, habilitará la sincronización y tu inventario quedará 100% visible en el sistema central.
