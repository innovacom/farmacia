# ============================================================
# tunel-bd.ps1 — Túnel SSH a la base de datos del VPS (DISMED)
# Mapea  127.0.0.1:<PuertoLocal>  ->  VPS:localhost:3306
# AUTO-RECONECTA si la conexión se cae. Ctrl+C para salir.
# Uso: doble clic en el acceso directo, o:  ./tunel-bd.ps1
# ============================================================
param([int]$PuertoLocal = 3307)

$Llave   = Join-Path $HOME ".ssh\id_ed25519"
$Usuario = "claude"
$ServidorIP = "72.249.60.175"

if (-not (Test-Path $Llave)) {
    Write-Host "ERROR: no se encontró la llave SSH en $Llave" -ForegroundColor Red
    Read-Host "Enter para salir"; exit 1
}

$Host.UI.RawUI.WindowTitle = "Túnel BD DISMED (127.0.0.1:$PuertoLocal)"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Túnel BD DISMED  ->  127.0.0.1:$PuertoLocal = VPS:3306" -ForegroundColor Cyan
Write-Host "  Se RECONECTA solo si se cae. Deja esta ventana ABIERTA." -ForegroundColor Cyan
Write-Host "  Ctrl+C para cerrar el túnel." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

while ($true) {
    $hora = Get-Date -Format "HH:mm:ss"
    Write-Host "[$hora] Conectando..." -ForegroundColor Green
    # -N: solo reenvío.  ServerAlive*: mantiene viva la sesión y detecta caídas.
    & ssh -i $Llave -N `
        -o StrictHostKeyChecking=no `
        -o ExitOnForwardFailure=yes `
        -o ServerAliveInterval=15 `
        -o ServerAliveCountMax=3 `
        -o TCPKeepAlive=yes `
        -L "$($PuertoLocal):localhost:3306" `
        "$Usuario@$ServidorIP"

    $hora = Get-Date -Format "HH:mm:ss"
    Write-Host "[$hora] Túnel caído. Reintentando en 3 s... (Ctrl+C para salir)" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
