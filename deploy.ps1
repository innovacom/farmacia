# ============================================================
# DISMED - Script de despliegue a produccion (Windows → Linux)
# Requisitos: PowerShell 5.1+, Windows 10/11, internet
# Uso: .\deploy.ps1
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  DISMED - Despliegue a servidor de produccion" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Leer credenciales desde .env.server ----
$EnvFile = Join-Path $ScriptDir ".env.server"
if (-not (Test-Path $EnvFile)) {
    Write-Host "ERROR: No se encontro .env.server en $ScriptDir" -ForegroundColor Red
    Write-Host "       Crea el archivo con las credenciales del servidor." -ForegroundColor Red
    exit 1
}

$cfg = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match "^([^#=\s]+)\s*=\s*(.+)$") {
        $cfg[$Matches[1]] = $Matches[2].Trim()
    }
}

$SERVER_HOST     = $cfg["SERVER_HOST"]
$SERVER_USER     = $cfg["SERVER_USER"]
$SERVER_PASS     = $cfg["SERVER_PASS"]
$APP_DIR         = $cfg["SERVER_APP_DIR"]
$DB_NAME         = $cfg["DB_NAME"]
$DB_USER         = $cfg["DB_USER"]
$DB_PASS         = $cfg["DB_PASS"]
$JWT_SECRET      = $cfg["JWT_SECRET"]
$ANTHROPIC_KEY   = $cfg["ANTHROPIC_API_KEY"]
$EMPRESA_NOMBRE  = $cfg["EMPRESA_NOMBRE"]
$EMPRESA_RFC     = $cfg["EMPRESA_RFC"]
$EMPRESA_TEL     = $cfg["EMPRESA_TELEFONO"]
$EMPRESA_EMAIL   = $cfg["EMPRESA_EMAIL"]
$EMPRESA_DIR     = $cfg["EMPRESA_DIRECCION"]
$SMTP_HOST       = $cfg["SMTP_HOST"]
$SMTP_PORT       = $cfg["SMTP_PORT"]
$SMTP_USER       = $cfg["SMTP_USER"]
$SMTP_PASS       = $cfg["SMTP_PASS"]

Write-Host "Servidor: $SERVER_USER@$SERVER_HOST" -ForegroundColor Green
Write-Host "App dir:  $APP_DIR" -ForegroundColor Green
Write-Host ""

# ---- 2. Instalar modulo Posh-SSH si no esta instalado ----
Write-Host "▶ Verificando modulo SSH para PowerShell..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Host "  Instalando Posh-SSH (solo se hace una vez)..."
    Install-Module -Name Posh-SSH -Force -AllowClobber -Scope CurrentUser -Repository PSGallery
}
Import-Module Posh-SSH -Force

# ---- 3. Empaquetar la aplicacion ----
Write-Host "▶ Empaquetando aplicacion (excluyendo node_modules)..." -ForegroundColor Yellow

$PackageName = "dismed-deploy.tar.gz"
$PackagePath = Join-Path $ScriptDir $PackageName
$TempDir     = Join-Path $ScriptDir "deploy-temp"

# Limpiar temp anterior
if (Test-Path $TempDir)     { Remove-Item -Recurse -Force $TempDir }
if (Test-Path $PackagePath) { Remove-Item -Force $PackagePath }

# Copiar archivos excluyendo node_modules, .env y dist/
New-Item -ItemType Directory -Force $TempDir | Out-Null
robocopy "$ScriptDir\dismed" "$TempDir\dismed" /E /XD "node_modules" ".git" "dist" /XF ".env" "*.log" /NFL /NDL /NJH /NJS | Out-Null

# Copiar deploy.sh al paquete
Copy-Item "$ScriptDir\deploy.sh" "$TempDir\deploy.sh"

# Crear tar.gz
Write-Host "  Creando archivo comprimido..."
Push-Location $TempDir
try {
    & tar -czf $PackagePath .
    if ($LASTEXITCODE -ne 0) { throw "Error al crear tar.gz" }
} finally {
    Pop-Location
}
Remove-Item -Recurse -Force $TempDir

$SizeMB = [math]::Round((Get-Item $PackagePath).Length / 1MB, 1)
Write-Host "  Paquete creado: $PackageName ($SizeMB MB)" -ForegroundColor Green

# ---- 4. Conectar al servidor ----
Write-Host ""
Write-Host "▶ Conectando al servidor $SERVER_HOST..." -ForegroundColor Yellow

$SecurePass  = ConvertTo-SecureString $SERVER_PASS -AsPlainText -Force
$Credential  = New-Object PSCredential($SERVER_USER, $SecurePass)

try {
    $SshSession  = New-SSHSession  -ComputerName $SERVER_HOST -Credential $Credential -AcceptKey -Force
    $SftpSession = New-SFTPSession -ComputerName $SERVER_HOST -Credential $Credential -AcceptKey -Force
} catch {
    Write-Host "ERROR: No se pudo conectar al servidor." -ForegroundColor Red
    Write-Host "Verifica IP, usuario y contrasena en .env.server" -ForegroundColor Red
    throw
}
Write-Host "  Conexion establecida." -ForegroundColor Green

# ---- 5. Subir paquete ----
Write-Host ""
Write-Host "▶ Subiendo paquete al servidor ($SizeMB MB)..." -ForegroundColor Yellow
Write-Host "  (Puede tomar varios minutos segun la velocidad de conexion)"
Set-SFTPFile -SessionId $SftpSession.SessionId -LocalFile $PackagePath -RemotePath "/tmp/$PackageName"
Write-Host "  Subida completada." -ForegroundColor Green

# ---- 6. Preparar variables de entorno para el servidor ----
# Escapar caracteres especiales para bash
function EscBash([string]$s) { $s -replace "'", "'\''" }

$EnvExports = @"
export APP_DIR='$(EscBash $APP_DIR)'
export PKG_DIR='/tmp/dismed-pkg'
export DB_NAME='$(EscBash $DB_NAME)'
export DB_USER='$(EscBash $DB_USER)'
export DB_PASS='$(EscBash $DB_PASS)'
export JWT_SECRET='$(EscBash $JWT_SECRET)'
export ANTHROPIC_API_KEY='$(EscBash $ANTHROPIC_KEY)'
export EMPRESA_NOMBRE='$(EscBash $EMPRESA_NOMBRE)'
export EMPRESA_RFC='$(EscBash $EMPRESA_RFC)'
export EMPRESA_TELEFONO='$(EscBash $EMPRESA_TEL)'
export EMPRESA_EMAIL='$(EscBash $EMPRESA_EMAIL)'
export EMPRESA_DIRECCION='$(EscBash $EMPRESA_DIR)'
export SERVER_HOST='$SERVER_HOST'
export SMTP_HOST='$(EscBash $SMTP_HOST)'
export SMTP_PORT='$(EscBash $SMTP_PORT)'
export SMTP_USER='$(EscBash $SMTP_USER)'
export SMTP_PASS='$(EscBash $SMTP_PASS)'
"@

# ---- 7. Ejecutar instalacion en el servidor ----
Write-Host ""
Write-Host "▶ Ejecutando instalacion en el servidor..." -ForegroundColor Yellow
Write-Host "  (El proceso puede tardar 5-15 minutos)"
Write-Host ""

$InstallCmd = @"
set -e
mkdir -p /tmp/dismed-pkg
tar -xzf /tmp/$PackageName -C /tmp/dismed-pkg
$EnvExports
sudo -E bash /tmp/dismed-pkg/deploy.sh
"@

$Result = Invoke-SSHCommand -SessionId $SshSession.SessionId `
    -Command $InstallCmd `
    -TimeOut 900

Write-Host $Result.Output

if ($Result.ExitStatus -ne 0) {
    Write-Host ""
    Write-Host "ERROR: El script de instalacion termino con errores." -ForegroundColor Red
    Write-Host "Error: $($Result.Error)" -ForegroundColor Red
    Write-Host "Revisa los logs con: ssh $SERVER_USER@$SERVER_HOST 'pm2 logs dismed-api'" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "  DISMED desplegado correctamente en produccion" -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URL del sistema:  http://$SERVER_HOST" -ForegroundColor White
    Write-Host "  API health check: http://$SERVER_HOST/api/health" -ForegroundColor White
    Write-Host "  Usuario admin:    admin@dismed.mx" -ForegroundColor White
    Write-Host "  Password inicial: Admin1234!" -ForegroundColor White
    Write-Host ""
    Write-Host "  IMPORTANTE despues del primer login:" -ForegroundColor Yellow
    Write-Host "  1. Cambia la password del admin" -ForegroundColor Yellow
    Write-Host "  2. Configura ANTHROPIC_API_KEY en el servidor:" -ForegroundColor Yellow
    Write-Host "     ssh $SERVER_USER@$SERVER_HOST" -ForegroundColor Cyan
    Write-Host "     nano $APP_DIR/backend/.env" -ForegroundColor Cyan
    Write-Host "     pm2 restart dismed-api" -ForegroundColor Cyan
    Write-Host ""
}

# ---- 8. Limpiar ----
Write-Host "▶ Limpiando archivos temporales..." -ForegroundColor Yellow
Invoke-SSHCommand -SessionId $SshSession.SessionId `
    -Command "rm -rf /tmp/dismed-pkg /tmp/$PackageName" | Out-Null
Remove-Item -Force $PackagePath -ErrorAction SilentlyContinue

Remove-SFTPSession -SessionId $SftpSession.SessionId
Remove-SSHSession  -SessionId $SshSession.SessionId

Write-Host "  Listo." -ForegroundColor Green
Write-Host ""
