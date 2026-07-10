#!/usr/bin/env python3
import sys, io, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST   = "72.249.60.175"
USER   = "root"
PASS   = "GaPaPaRoEl1"
DOMAIN = "sistema.innovacom.mx"
APP    = "/var/www/dismed"

def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=20)
    return c

def run(ssh, cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

def write_remote(ssh, path, content):
    sftp = ssh.open_sftp()
    with sftp.open(path, "w") as f:
        f.write(content)
    sftp.close()

# ── Configs Apache ────────────────────────────────────────────────
http_conf = """<VirtualHost *:80>
    ServerName sistema.innovacom.mx
    ServerAlias www.sistema.innovacom.mx 72.249.60.175
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</VirtualHost>
"""

ssl_conf = """<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName sistema.innovacom.mx
    ServerAlias www.sistema.innovacom.mx

    DocumentRoot /var/www/dismed/frontend/dist

    <Directory /var/www/dismed/frontend/dist>
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

    ErrorLog  ${APACHE_LOG_DIR}/dismed_error.log
    CustomLog ${APACHE_LOG_DIR}/dismed_access.log combined

    SSLCertificateFile    /etc/letsencrypt/live/sistema.innovacom.mx/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/sistema.innovacom.mx/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
"""

# ── PASO 1: Escribir archivos via SFTP ────────────────────────────
print("Conectando para escribir archivos...")
ssh1 = connect()
write_remote(ssh1, "/etc/apache2/sites-available/dismed.conf",        http_conf)
print("  OK  dismed.conf")
write_remote(ssh1, "/etc/apache2/sites-available/dismed-le-ssl.conf", ssl_conf)
print("  OK  dismed-le-ssl.conf")
ssh1.close()
print()

# ── PASO 2: Ejecutar comandos en nueva sesion ─────────────────────
print("Conectando para ejecutar comandos...")
ssh2 = connect()

cmds = [
    ("Habilitando SSL site",    "a2ensite dismed-le-ssl.conf 2>&1 | tail -1"),
    ("Habilitando modulo rewrite","a2enmod rewrite 2>&1 | tail -1"),
    ("Test Apache config",      "apache2ctl configtest 2>&1"),
    ("Reload Apache",           "systemctl reload apache2 && echo 'Apache OK' || echo 'ERROR reload'"),
    ("BASE_URL https",          f"sed -i 's|^BASE_URL=.*|BASE_URL=https://{DOMAIN}|' {APP}/backend/.env && "
                                f"sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=https://{DOMAIN}|' {APP}/backend/.env && "
                                f"grep -E 'BASE_URL|FRONTEND_URL' {APP}/backend/.env"),
    ("Restart backend",         "pm2 restart dismed-api && sleep 3 && pm2 list | grep dismed"),
    ("Prueba HTTP->HTTPS",      f"curl -s -o /dev/null -w '%{{http_code}} -> %{{url_effective}}' http://{DOMAIN}/"),
    ("Prueba HTTPS",            f"curl -sk -o /dev/null -w 'HTTP %{{http_code}}' https://{DOMAIN}/"),
]

for label, cmd in cmds:
    result = run(ssh2, cmd)
    print(f"  [{label}]")
    for line in result.split("\n"):
        if line.strip():
            print(f"    {line}")
    print()

ssh2.close()
print(f"Accede en: https://{DOMAIN}")
