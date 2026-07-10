#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST = "72.249.60.175"
USER = "root"
PASS = "GaPaPaRoEl1"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

print("=== Apache VirtualHost activo ===")
print(run("cat /etc/apache2/sites-enabled/dismed.conf 2>/dev/null || echo 'archivo no encontrado'"))

print("\n=== Todos los sites disponibles ===")
print(run("ls /etc/apache2/sites-enabled/"))

print("\n=== ServerName en configs ===")
print(run("grep -r 'ServerName' /etc/apache2/sites-enabled/"))

print("\n=== Apache escuchando en puertos ===")
print(run("apache2ctl -S 2>&1 | head -30"))

print("\n=== Backend PM2 status ===")
print(run("pm2 status 2>&1"))

print("\n=== .env BASE_URL y FRONTEND_URL ===")
print(run("grep -E 'BASE_URL|FRONTEND_URL|EMPRESA' /var/www/dismed/backend/.env"))

ssh.close()
