#!/usr/bin/env python3
"""discover_vps.py — Inspección (solo lectura) del VPS antes del despliegue CFDI."""
import sys, paramiko
from pathlib import Path

def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg

cfg = load_env(Path(__file__).parent / ".env.server")
host, user, pwd = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]
APP = cfg.get("SERVER_APP_DIR", "/var/www/dismed")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, username=user, password=pwd, timeout=30)

def run(cmd):
    _, out, err = ssh.exec_command(cmd, timeout=60)
    return out.read().decode("utf-8", "replace") + err.read().decode("utf-8", "replace")

print("== node/npm/pm2 ==")
print(run("node -v; npm -v; pm2 -v 2>/dev/null; which pm2"))
print("== app dir ==")
print(run(f"ls -la {APP}"))
print("== backend dir ==")
print(run(f"ls {APP}/backend | head -40"))
print("== backend modules ==")
print(run(f"ls {APP}/backend/src/modules"))
print("== migrate files presentes ==")
print(run(f"ls {APP}/backend/migrate_v*.js 2>/dev/null"))
print("== .env keys (solo nombres) ==")
print(run(f"grep -oE '^[A-Z_]+=' {APP}/backend/.env 2>/dev/null | sort"))
print("== efirma dir? ==")
print(run(f"ls -la {APP}/efirma 2>/dev/null || echo 'NO existe {APP}/efirma'"))
print("== pm2 list ==")
print(run("pm2 list 2>/dev/null"))
print("== disk ==")
print(run("df -h / | tail -1"))
print("== cfdi module ya existe? ==")
print(run(f"ls {APP}/backend/src/modules/cfdi 2>/dev/null || echo 'NO existe modulo cfdi'"))

ssh.close()
