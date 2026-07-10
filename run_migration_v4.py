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

steps = [
    ("solicitudes_partidas.descripcion_original → VARCHAR(1000)",
     "ALTER TABLE solicitudes_partidas MODIFY COLUMN descripcion_original VARCHAR(1000) NOT NULL"),
    ("cotizaciones_cliente_partidas.descripcion → VARCHAR(1000)",
     "ALTER TABLE cotizaciones_cliente_partidas MODIFY COLUMN descripcion VARCHAR(1000) NOT NULL"),
]

for name, sql in steps:
    out = run(f"mysql -u root -p'{PASS}' {DB} -e \"{sql}\" 2>&1")
    if "error" in out.lower():
        print(f"FAIL {name}: {out}")
    else:
        print(f"OK   {name}")

ssh.close()
