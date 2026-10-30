# Arranca el entorno local completo de TourGirls (NestJS + PostgreSQL):
#   - PostgreSQL embebido          localhost:5433   (datos en .data/postgres)
#   - Autenticacion (dev-auth)     http://localhost:5280
#   - API + Swagger                http://localhost:5276/docs
#   - Frontend (Vite)              http://localhost:5173
#
# Uso:  .\start-local.cmd            (o: powershell -ExecutionPolicy Bypass -File .\start-local.ps1)
#       .\start-local.cmd -Stop      detiene los cuatro servicios
#       .\start-local.cmd -NoBrowser no abre el navegador
param(
    [switch]$Stop,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$ports = [ordered]@{ Db = 5433; Auth = 5280; Api = 5276; Web = 5173 }

function Stop-Port([int]$port) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

function Wait-Port([int]$port, [string]$name, [int]$seconds = 120) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return }
        Start-Sleep -Seconds 1
    }
    throw "$name no abrio el puerto $port tras $seconds s. Revisa su ventana."
}

function Wait-Url([string]$url, [string]$name, [int]$seconds = 120) {
    for ($i = 0; $i -lt $seconds; $i++) {
        try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null; return } catch {
            if ($_.Exception.Response) { return }
            Start-Sleep -Seconds 1
        }
    }
    throw "$name no respondio en $url tras $seconds s. Revisa su ventana."
}

function Start-LocalService([string]$title, [string]$workdir, [string]$command) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$workdir'; $command"
    Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $script | Out-Null
}

function New-LocalEnvFiles {
    # Crea apps/api/.env y apps/auth/.env la primera vez, con un secreto JWT compartido aleatorio.
    $apiEnv = Join-Path $root 'apps\api\.env'
    $authEnv = Join-Path $root 'apps\auth\.env'
    if ((Test-Path $apiEnv) -and (Test-Path $authEnv)) { return }
    $secret = node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))"
    $db = 'postgres://postgres:tourgirls-local@localhost:5433/tourgirls'
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($apiEnv, "PORT=5276`nDATABASE_URL=$db`nAUTH_JWT_SECRET=$secret`nAUTH_ISSUER=tourgirls-auth`nAUTH_AUDIENCE=tourgirls-api`nCORS_ORIGINS=http://localhost:5173`nSWAGGER_ENABLED=true`n", $utf8)
    [IO.File]::WriteAllText($authEnv, "PORT=5280`nDATABASE_URL=$db`nAUTH_JWT_SECRET=$secret`nAUTH_ISSUER=tourgirls-auth`nAUTH_AUDIENCE=tourgirls-api`nCORS_ORIGINS=http://localhost:5173,http://localhost:5276`nADMIN_EMAILS=admin@tourgirls.test`n", $utf8)
    Write-Host 'Creados apps/api/.env y apps/auth/.env con un secreto JWT nuevo.' -ForegroundColor Cyan
}

if ($Stop) {
    $ports.Values | ForEach-Object { Stop-Port $_ }
    Write-Host 'Servicios locales detenidos.' -ForegroundColor Yellow
    return
}

foreach ($tool in 'node', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Falta '$tool' en el PATH." }
}

$ports.Values | ForEach-Object { Stop-Port $_ }

$web = Join-Path $root 'AtraccionesService-web'
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Instalando dependencias del backend...' -ForegroundColor Cyan
    Push-Location $root; npm install --no-audit --no-fund; Pop-Location
}
if (-not (Test-Path (Join-Path $web 'node_modules'))) {
    Write-Host 'Instalando dependencias del frontend...' -ForegroundColor Cyan
    Push-Location $web; npm install --no-audit --no-fund; Pop-Location
}

New-LocalEnvFiles

Write-Host 'Compilando API y dev-auth...' -ForegroundColor Cyan
Push-Location $root; npm run build; $code = $LASTEXITCODE; Pop-Location
if ($code -ne 0) { throw 'La compilacion fallo.' }

Write-Host 'Iniciando servicios...' -ForegroundColor Cyan
Start-LocalService 'PostgreSQL :5433' $root 'node tools/local-db.mjs'
Wait-Port $ports.Db 'PostgreSQL'

Write-Host 'Migrando las bases de datos de los microservicios...' -ForegroundColor Cyan
Push-Location $root; node tools/migrate-services.mjs; $code = $LASTEXITCODE; Pop-Location
if ($code -ne 0) { throw 'Las migraciones de los microservicios fallaron.' }

Start-LocalService 'Auth :5280' $root 'node apps/auth/dist/main.js'
Start-LocalService 'API :5276' $root 'node apps/api/dist/main.js'
Start-LocalService 'Web :5173' $web 'npm run dev'

Wait-Url "http://localhost:$($ports.Auth)/health" 'El servicio de autenticacion'
Wait-Url "http://localhost:$($ports.Api)/health" 'El API'
Wait-Url "http://localhost:$($ports.Web)/" 'El frontend'

Write-Host ''
Write-Host 'Entorno local de TourGirls listo:' -ForegroundColor Green
Write-Host "  Frontend             http://localhost:$($ports.Web)"
Write-Host "  Swagger (API)        http://localhost:$($ports.Api)/docs"
Write-Host "  Autenticacion        http://localhost:$($ports.Auth)  (POST /auth/register, /auth/login)"
Write-Host "  PostgreSQL           postgres://postgres:tourgirls-local@localhost:$($ports.Db)/tourgirls"
Write-Host ''
Write-Host 'Crea tu cuenta con "Crear cuenta" en el frontend.'
Write-Host 'Administrador: registra admin@tourgirls.test, inicia sesion una vez y ejecuta'
Write-Host '  node tools/grant-admin.mjs admin@tourgirls.test'
Write-Host ''
Write-Host 'Para detener todo:  .\start-local.cmd -Stop' -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process "http://localhost:$($ports.Web)"
    Start-Process "http://localhost:$($ports.Api)/docs"
}
