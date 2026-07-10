#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import paramiko

HOST = "72.249.60.175"; USER = "root"; PASS = "GaPaPaRoEl1"; DB = "dismed_db"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

def run(cmd):
    _, o, e = ssh.exec_command(cmd)
    return (o.read() + e.read()).decode("utf-8", errors="replace").strip()

sql = "ALTER TABLE solicitudes_partidas ADD COLUMN IF NOT EXISTS codigo_gobierno VARCHAR(80) NULL AFTER codigo_cliente"
out = run(f"mysql -u root -p'{PASS}' {DB} -e \"{sql}\" 2>&1")
combined = out.lower()
if "error" in combined and "duplicate" not in combined:
    print(f"FAIL: {out}")
else:
    print("OK   solicitudes_partidas.codigo_gobierno agregado")

ssh.close()
