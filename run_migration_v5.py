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
    ("cotizaciones_proveedor_precios.observaciones_proveedor -> VARCHAR(1000)",
     "ALTER TABLE cotizaciones_proveedor_precios MODIFY COLUMN observaciones_proveedor VARCHAR(1000) NULL"),
    ("cotizaciones_proveedor_precios.sku_proveedor -> VARCHAR(100)",
     "ALTER TABLE cotizaciones_proveedor_precios MODIFY COLUMN sku_proveedor VARCHAR(100) NULL"),
    ("proveedores_skus.sku_proveedor -> VARCHAR(100)",
     "ALTER TABLE proveedores_skus MODIFY COLUMN sku_proveedor VARCHAR(100) NOT NULL"),
]

for name, sql in steps:
    out = run(f"mysql -u root -p'{PASS}' {DB} -e \"{sql}\" 2>&1")
    if "error" in out.lower():
        print(f"FAIL {name}: {out}")
    else:
        print(f"OK   {name}")

ssh.close()
