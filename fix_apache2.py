#!/usr/bin/env python3
import sys, io
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST   = "72.249.60.175"
USER   = "root"
PASS   = "GaPaPaRoEl1"
DOMAIN = "sistema.innovacom.mx"
IP     = "72.249.60.175"
APP    = "/var/www/dismed"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = ssh.open_sftp()

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

def write_file(remote_path, content):
    with sftp.open(remote_path, "w") as f:
        f.write(content)

# ── 1. HTTP VirtualHost: dominio + redirect a HTTPS ──────────────
http_conf = f"""<VirtualHost *:80>
    ServerName {DOMAIN}
    ServerAlias www.{DOMAIN} {IP}
    # Redirigir todo a HTTPS
    RewriteEngine On
    RewriteCond %{{HTTPS}} off
    RewriteRule ^ https://%{{HTTP_HOST}}%{{REQUEST_URI}} [R=301,L]
</VirtualHost>
"""

# ── 2. HTTPS VirtualHost: DocumentRoot CORREGIDO con /dist ────────
ssl_conf = f"""<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName {DOMAIN}
    ServerAlias www.{DOMAIN}

    DocumentRoot {APP}/frontend/dist

    <Directory {APP}/frontend/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass        /api      http://127.0.0.1:3001/api
    ProxyPassReverse /api      http://127.0.0.1:3001/api
    ProxyPass        /outputs  http://127.0.0.1:3001/outputs
    ProxyPassReverse /outputs  http://127.0.0.1:3001/outputs

    ErrorLog  ${{APACHE_LOG_DIR}}/dismed_error.log
    CustomLog ${{APACHE_LOG_DIR}}/dismed_access.log combined

    SSLCertificateFile    /etc/letsencrypt/live/{DOMAIN}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/{DOMAIN}/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
"""

print("=== Escribiendo configs Apache via SFTP ===")
write_file("/etc/apache2/sites-available/dismed.conf",        http_conf)
print("  OK  dismed.conf (HTTP → redirect HTTPS)")
write_file("/etc/apache2/sites-available/dismed-le-ssl.conf", ssl_conf)
print("  OK  dismed-le-ssl.conf (HTTPS, DocumentRoot corregido a /dist)")

# ── 3. Habilitar ambos sites ──────────────────────────────────────
print("\n=== Habilitando sites y módulos ===")
print("  " + run("a2ensite dismed.conf 2>&1 | tail -1"))
print("  " + run("a2ensite dismed-le-ssl.conf 2>&1 | tail -1"))
print("  " + run("a2enmod ssl rewrite proxy proxy_http 2>&1 | tail -1"))

# ── 4. Actualizar BASE_URL en .env ────────────────────────────────
print("\n=== Actualizando .env (BASE_URL → HTTPS) ===")
run(f"sed -i 's|^BASE_URL=.*|BASE_URL=https://{DOMAIN}|' {APP}/backend/.env")
run(f"sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://{DOMAIN}|' {APP}/backend/.env")
print("  " + run(f"grep -E 'BASE_URL|FRONTEND_URL' {APP}/backend/.env"))

# ── 5. Test y reload Apache ───────────────────────────────────────
print("\n=== Verificando config Apache ===")
test = run("apache2ctl configtest 2>&1")
print("  " + test.replace("\n", "\n  "))

if "Syntax OK" in test:
    print("\n=== Recargando Apache ===")
    print("  " + run("systemctl reload apache2 2>&1 && echo 'Apache OK'"))
else:
    print("  ERROR — revisa la configuracion")
    sftp.close(); ssh.close(); sys.exit(1)

# ── 6. Reiniciar backend ──────────────────────────────────────────
print("\n=== Reiniciando backend ===")
run("pm2 restart dismed-api")
import time; time.sleep(3)
print("  " + run("pm2 list 2>&1 | grep dismed-api | awk '{print $4, $10, $12}'"))

# ── 7. Prueba final ───────────────────────────────────────────────
print("\n=== Prueba de acceso ===")
r80  = run(f"curl -s -o /dev/null -w '%{{http_code}} redirige a %{{url_effective}}' http://{DOMAIN}/ 2>&1")
r443 = run(f"curl -sk -o /dev/null -w '%{{http_code}}' https://{DOMAIN}/ 2>&1")
print(f"  HTTP  → {r80}")
print(f"  HTTPS → {r443}")

sftp.close()
ssh.close()
print(f"\nSistema disponible en: https://{DOMAIN}\n")
