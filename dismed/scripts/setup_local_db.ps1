<#
  setup_local_db.ps1 — Monta un ambiente de pruebas LOCAL fiel a producción.

  Qué hace (en este orden):
    1. Importa el esquema base (dismed_schema_vmariadb.sql) en la MariaDB local.
    2. Crea el usuario de la app en localhost con las credenciales que ya están
       en backend/.env (NO las hardcodea: las lee de ahí) y le da privilegios.
    3. Corre el seed (crea tabla usuarios + admin inicial).
    4. Aplica todas las migraciones migrate_v2..v15 en orden.

  La contraseña de root NUNCA se guarda: se pide de forma segura o se pasa por
  parámetro solo para esta corrida. Las credenciales de la app salen del .env.

  Uso:
    # Inicializa desde cero (BORRA y recrea dismed_db local — es un ambiente de pruebas):
    powershell -ExecutionPolicy Bypass -File dismed/scripts/setup_local_db.ps1 -Fresh

    # Si la BD ya existe y solo quieres re-aplicar usuario/seed/migraciones:
    powershell -ExecutionPolicy Bypass -File dismed/scripts/setup_local_db.ps1

    # Root no interactivo (opcional):
    ... -Fresh -RootUser root -RootPassword 'TU_ROOT_PW'
#>
[CmdletBinding()]
param(
  [string]$RootUser = 'root',
  [string]$RootPassword,
  [switch]$Fresh
)

$ErrorActionPreference = 'Stop'
# Piping a mysql en UTF-8 (el esquema tiene acentos y datos en español).
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$repo    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ...\sistema cotizaciones
$backend = Join-Path $repo 'dismed\backend'
$schema  = Join-Path $repo 'dismed_schema_vmariadb.sql'
$envFile = Join-Path $backend '.env'

function Find-Mysql {
  $cand = @(
    'C:\Program Files\MariaDB*\bin\mysql.exe',
    'C:\Program Files\MySQL*\bin\mysql.exe',
    'C:\Program Files (x86)\MariaDB*\bin\mysql.exe'
  )
  foreach ($g in $cand) {
    $f = Get-ChildItem $g -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  $c = Get-Command mysql -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  throw "No se encontró mysql.exe (MariaDB/MySQL)."
}

function Get-EnvVar([string]$content, [string]$key) {
  $m = [regex]::Match($content, "(?m)^\s*$key\s*=\s*(.+?)\s*$")
  if (-not $m.Success) { throw "No se encontró $key en $envFile" }
  return $m.Groups[1].Value.Trim()
}

# --- Localizar herramientas y credenciales ---
$mysql = Find-Mysql
Write-Host "mysql.exe : $mysql"
if (-not (Test-Path $envFile)) { throw "No existe $envFile" }
if (-not (Test-Path $schema))  { throw "No existe $schema" }

$envContent = Get-Content $envFile -Raw
$dbUser = Get-EnvVar $envContent 'DB_USER'
$dbPass = Get-EnvVar $envContent 'DB_PASSWORD'
$dbName = Get-EnvVar $envContent 'DB_NAME'
Write-Host "App DB    : usuario '$dbUser' -> base '$dbName' (credenciales tomadas de .env)"

# --- Contraseña root (segura) ---
# Orden: parámetro -RootPassword > variable de entorno > prompt interactivo.
# La variable de entorno permite correrlo sin terminal interactiva (p.ej. en segundo
# plano) sin exponer la contraseña en la línea de comandos:
#   $env:DISMED_MARIADB_ROOT_PWD = '...'   (en TU propia terminal)
if (-not $RootPassword -and $env:DISMED_MARIADB_ROOT_PWD) {
  $RootPassword = $env:DISMED_MARIADB_ROOT_PWD
}
if (-not $RootPassword) {
  $interactive = [Environment]::UserInteractive -and $Host.Name -ne 'Default Host'
  if (-not $interactive) {
    throw "No hay terminal interactiva para pedir la contraseña de root. " +
          "Ejecuta este script en una ventana de PowerShell propia, " +
          "o define `$env:DISMED_MARIADB_ROOT_PWD antes de correrlo, " +
          "o pasa -RootPassword 'TU_PW'."
  }
  $sec = Read-Host "Contraseña de MariaDB para '$RootUser'@localhost" -AsSecureString
  $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# Helper: ejecuta mysql como root con el SQL por STDIN (así DELIMITER de los stored
# procedures funciona). Usa Start-Process con redirección a archivos temporales para
# evitar el "NativeCommandError" que PowerShell genera cuando mysql escribe en stderr.
# La contraseña va por MYSQL_PWD (nunca en la línea de comandos). El éxito se juzga por
# el código de salida real del proceso, no por stderr.
function Invoke-MysqlStdin([string]$stdinText, [switch]$Tolerant) {
  $tmpIn  = [System.IO.Path]::GetTempFileName()
  $tmpOut = [System.IO.Path]::GetTempFileName()
  $tmpErr = [System.IO.Path]::GetTempFileName()
  $utf8   = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmpIn, $stdinText, $utf8)
  $env:MYSQL_PWD = $RootPassword
  $myArgs = @('-u', $RootUser, '--default-character-set=utf8mb4')
  if ($Tolerant) { $myArgs += '--force' }   # continúa pese a errores conocidos del esquema base
  try {
    $p = Start-Process -FilePath $mysql -ArgumentList $myArgs -NoNewWindow -Wait -PassThru `
           -RedirectStandardInput $tmpIn -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $code   = $p.ExitCode
    $outTxt = [System.IO.File]::ReadAllText($tmpOut)
    $errTxt = [System.IO.File]::ReadAllText($tmpErr)
    if (-not $Tolerant -and $code -ne 0) { throw "mysql fallo (codigo $code):`n$errTxt$outTxt" }
    return ($errTxt + $outTxt)
  } finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    Remove-Item $tmpIn, $tmpOut, $tmpErr -ErrorAction SilentlyContinue
  }
}
function Invoke-RootSql([string]$sql)   { return Invoke-MysqlStdin $sql }
function Invoke-RootFile([string]$path) {
  $text = Invoke-MysqlStdin (Get-Content $path -Raw -Encoding UTF8) -Tolerant
  $errLines = $text -split "`r?`n" | Where-Object { $_ -match 'ERROR \d' }
  if ($errLines) {
    Write-Host "      Avisos esperados del esquema base (los corrigen las migraciones):" -ForegroundColor Yellow
    $errLines | ForEach-Object { Write-Host ("        " + $_.Trim()) -ForegroundColor DarkYellow }
  }
  return $text
}

# --- Verificar conectividad root antes de tocar nada ---
Write-Host "`n[1/5] Verificando acceso root..." -ForegroundColor Cyan
Invoke-RootSql "SELECT 'ok' AS conexion;" | Out-Null
Write-Host "      Acceso root OK."

# --- Esquema base ---
$dbExists = (Invoke-RootSql "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$dbName';") -match $dbName
if ($Fresh) {
  Write-Host "`n[2/5] Importando esquema base (BORRA y recrea '$dbName')..." -ForegroundColor Cyan
  Invoke-RootFile $schema
  Write-Host "      Esquema importado."
} elseif (-not $dbExists) {
  Write-Host "`n[2/5] '$dbName' no existe; importando esquema base..." -ForegroundColor Cyan
  Invoke-RootFile $schema
  Write-Host "      Esquema importado."
} else {
  Write-Host "`n[2/5] '$dbName' ya existe; conservando datos (usa -Fresh para reiniciar)." -ForegroundColor Yellow
}

# --- Usuario de la app (localhost) con las credenciales del .env ---
Write-Host "`n[3/5] Creando/actualizando usuario de la app '$dbUser'@localhost..." -ForegroundColor Cyan
$escPass = $dbPass.Replace("'", "''")
Invoke-RootSql @"
CREATE DATABASE IF NOT EXISTS ``$dbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$dbUser'@'localhost' IDENTIFIED BY '$escPass';
ALTER USER '$dbUser'@'localhost' IDENTIFIED BY '$escPass';
GRANT ALL PRIVILEGES ON ``$dbName``.* TO '$dbUser'@'localhost';
FLUSH PRIVILEGES;
"@ | Out-Null
Write-Host "      Usuario listo con privilegios sobre '$dbName'."

# El esquema base crea 'usuarios' con su forma antigua; migrate_v2 le agrega puesto/jefe_id
# (y el resto de migraciones ponen al día las demás tablas). Por eso las migraciones van
# ANTES del seed: así seed.js inserta el admin sobre la tabla ya actualizada.
Push-Location $backend
try {
  # --- Migraciones en orden (todas las disponibles desde v2) ---
  $maxMig = 2
  while (Test-Path "migrate_v$($maxMig + 1).js") { $maxMig++ }
  Write-Host "`n[4/5] Aplicando migraciones v2..$maxMig..." -ForegroundColor Cyan
  foreach ($n in 2..$maxMig) {
    $mig = "migrate_v$n.js"
    if (Test-Path $mig) {
      Write-Host "      -> $mig"
      & node $mig
      if ($LASTEXITCODE -ne 0) { throw "$mig fallo (codigo $LASTEXITCODE)" }
    }
  }

  # --- Seed (admin inicial) sobre la tabla usuarios ya migrada ---
  Write-Host "`n[5/5] Ejecutando seed (admin inicial)..." -ForegroundColor Cyan
  & node 'src/modules/auth/seed.js'
  if ($LASTEXITCODE -ne 0) { throw "seed.js fallo (codigo $LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host "`n=========================================================" -ForegroundColor Green
Write-Host " Ambiente local listo." -ForegroundColor Green
Write-Host " Base : $dbName  (MariaDB local)"
Write-Host " App  : usuario '$dbUser'@localhost (igual que .env)"
Write-Host " Admin: el que imprima el seed (cámbialo al primer login)."
Write-Host " Arranca:  cd dismed/backend && npm run dev"
Write-Host "           cd dismed/frontend && npm run dev"
Write-Host "=========================================================" -ForegroundColor Green
