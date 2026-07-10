#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST = "72.249.60.175"
USER = "root"
PASS = "GaPaPaRoEl1"
DOMAIN = "sistema.innovacom.mx"
APP_DIR = "/var/www/dismed"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    out = (o.read() + e.read()).decode("utf-8", errors="replace").strip()
    return out

# Ver el config SSL actual
print("=== Config SSL actual ===")
print(run("cat /etc/apache2/sites-enabled/dismed-le-ssl.conf 2>/dev/null || echo 'no existe'"))
print()

# ── 1. Reescribir dismed.conf para que acepte IP Y dominio ────────
new_conf = f"""<VirtualHost *:80>
    ServerName {DOMAIN}
    ServerAlias www.{DOMAIN} {HOST}

    DocumentRoot {APP_DIR}/frontend/dist

    <Directory {APP_DIR}/frontend/dist>
        AllowOverride All
        Require all granted
        Options -Indexes
        FallbackResource /index.html
    </Directory>

    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api
    ProxyPass /outputs http://localhost:3001/outputs
    ProxyPassReverse /outputs http://localhost:3001/outputs

    ErrorLog ${{APACHE_LOG_DIR}}/dismed-error.log
    CustomLog ${{APACHE_LOG_DIR}}/dismed-access.log combined
</VirtualHost>
"""

print("=== Actualizando dismed.conf (HTTP) ===")
# Escribir el nuevo config
write_cmd = f"cat > /etc/apache2/sites-available/dismed.conf << 'APACHEEOF'\n{new_conf}\nAPACHEOF"
run(write_cmd)
print("  OK dismed.conf actualizado")

# ── 2. Deshabilitar el SSL roto (si existe) ────────────────────────
print("\n=== Deshabilitando SSL config anterior ===")
out = run("a2dissite dismed-le-ssl.conf 2>&1 || echo 'no habia ssl activo'")
print(f"  {out.split(chr(10))[0]}")

# ── 3. Actualizar BASE_URL en .env del backend ────────────────────
print("\n=== Actualizando BASE_URL en .env ===")
run(f"sed -i 's|^BASE_URL=.*|BASE_URL=http://{DOMAIN}|' {APP_DIR}/backend/.env")
run(f"sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=http://{DOMAIN}|' {APP_DIR}/backend/.env")
check = run(f"grep -E 'BASE_URL|FRONTEND_URL' {APP_DIR}/backend/.env")
print(f"  {check}")

# ── 4. Verificar config Apache y reiniciar ─────────────────────────
print("\n=== Verificando configuracion Apache ===")
test = run("apache2ctl configtest 2>&1")
print(f"  {test}")

if "Syntax OK" in test:
    print("\n=== Reiniciando Apache ===")
    out = run("systemctl reload apache2 2>&1 && echo 'Apache recargado OK'")
    print(f"  {out}")
else:
    print("  ERROR en config — no se reinicio Apache")

# ── 5. Reiniciar backend con nuevo BASE_URL ────────────────────────
print("\n=== Reiniciando backend (PM2) ===")
run("pm2 restart dismed-api")
import time; time.sleep(3)
status = run("pm2 list 2>&1 | grep dismed-api")
print(f"  {status}")

# ── 6. Prueba de acceso ────────────────────────────────────────────
print("\n=== Prueba de acceso HTTP ===")
result = run(f"curl -s -o /dev/null -w '%{{http_code}} -> %{{url_effective}}' http://{DOMAIN}/ 2>&1")
print(f"  http://{DOMAIN}/ → {result}")

ssh.close()
print(f"\nListo. Prueba en: http://{DOMAIN}\n")
