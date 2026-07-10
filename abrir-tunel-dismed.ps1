# abrir-tunel-dismed.ps1
# Abre el tunel SSH para que el MCP "dismed-mysql" pueda consultar la BD del VPS.
# Mapea  127.0.0.1:<PuertoLocal>  ->  VPS:localhost:3306 (MySQL/MariaDB de dismed_db).
# Deja esta ventana abierta mientras quieras consultar la base. Ctrl+C para cerrar el tunel.
#
# Uso:
#   Doble clic (o: clic derecho > "Ejecutar con PowerShell")
#   o desde una terminal:  ./abrir-tunel-dismed.ps1            (puerto 3307 por defecto)
#                          ./abrir-tunel-dismed.ps1 -PuertoLocal 3308

param(
    [int]$PuertoLocal = 3307
)

$Llave   = Join-Path $HOME ".ssh\id_ed25519"
$Usuario = "claude"
$Host_   = "72.249.60.175"

if (-not (Test-Path $Llave)) {
    Write-Host "ERROR: no se encontro la llave SSH en $Llave" -ForegroundColor Red
    Read-Host "Enter para salir"
    exit 1
}

# Avisar si el puerto local ya esta ocupado
$enUso = Get-NetTCPConnection -LocalPort $PuertoLocal -State Listen -ErrorAction SilentlyContinue
if ($enUso) {
    Write-Host "AVISO: el puerto $PuertoLocal ya esta en uso." -ForegroundColor Yellow
    Write-Host "Quiza el tunel ya esta abierto, o eligelo distinto con -PuertoLocal 3308 (y ajusta MYSQL_PORT en .mcp.json)." -ForegroundColor Yellow
    Read-Host "Enter para salir"
    exit 1
}

Write-Host "Abriendo tunel  127.0.0.1:$PuertoLocal  ->  $Host_:3306 ..." -ForegroundColor Cyan
Write-Host "Deja esta ventana ABIERTA. Ctrl+C para cerrar el tunel." -ForegroundColor Cyan
Write-Host ""

# -N: sin comando remoto (solo reenvio). -o ExitOnForwardFailure: falla rapido si el puerto remoto no responde.
& ssh -i $Llave -N -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -L "$($PuertoLocal):localhost:3306" "$Usuario@$Host_"

Write-Host ""
Write-Host "Tunel cerrado." -ForegroundColor DarkGray
Read-Host "Enter para salir"
