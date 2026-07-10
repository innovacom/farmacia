# subir_a_github.ps1
# Sube los cambios pendientes de esta carpeta al repo github.com/innovacom/erp
# Uso:
#   .\subir_a_github.ps1
#   .\subir_a_github.ps1 "mensaje descriptivo del cambio"

param(
    [string]$mensaje = "Actualizacion $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

git add -A
git status --short

$cambios = git status --porcelain
if ([string]::IsNullOrWhiteSpace($cambios)) {
    Write-Host "No hay cambios pendientes por subir."
    exit 0
}

git commit -m "$mensaje"
git push origin main

Write-Host "Listo. Cambios subidos a github.com/innovacom/erp"
