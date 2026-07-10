#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from pathlib import Path

try:
    import paramiko
except ImportError:
    print("ERROR: pip install paramiko")
    sys.exit(1)

HOST = "72.249.60.175"
USER = "root"
PASS = "GaPaPaRoEl1"
DB   = "dismed_db"

STEPS = [
    ("usuarios - ADD puesto",
     "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS puesto VARCHAR(100) NULL AFTER nombre"),
    ("usuarios - ADD jefe_id",
     "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS jefe_id INT UNSIGNED NULL AFTER rol"),
    ("usuarios - FK jefe_id",
     "ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_jefe FOREIGN KEY (jefe_id) REFERENCES usuarios(id) ON UPDATE CASCADE"),
    ("cotizaciones_cliente - ADD concepto",
     "ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS concepto VARCHAR(200) NULL AFTER folio"),
    ("cotizaciones_cliente - ADD contacto_id",
     "ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS contacto_id INT UNSIGNED NULL AFTER cliente_id"),
    ("cotizaciones_cliente - ADD elaborado_por_id",
     "ALTER TABLE cotizaciones_cliente ADD COLUMN IF NOT EXISTS elaborado_por_id INT UNSIGNED NULL AFTER contacto_id"),
    ("cotizaciones_cliente - FK contacto_id",
     "ALTER TABLE cotizaciones_cliente ADD CONSTRAINT fk_cotcli_contacto FOREIGN KEY (contacto_id) REFERENCES clientes_contactos(id) ON UPDATE CASCADE"),
    ("cotizaciones_cliente - FK elaborado_por_id",
     "ALTER TABLE cotizaciones_cliente ADD CONSTRAINT fk_cotcli_elaborado FOREIGN KEY (elaborado_por_id) REFERENCES usuarios(id) ON UPDATE CASCADE"),
    ("cotizaciones_cliente_partidas - ADD iva_exento",
     "ALTER TABLE cotizaciones_cliente_partidas ADD COLUMN IF NOT EXISTS iva_exento TINYINT(1) NOT NULL DEFAULT 0 AFTER observaciones"),
    ("productos - ADD iva_exento",
     "ALTER TABLE productos ADD COLUMN IF NOT EXISTS iva_exento TINYINT(1) NOT NULL DEFAULT 0 AFTER stock_minimo"),
]

ENV_UPDATES = {
    "EMPRESA_NOMBRE":    "INNOVACOM",
    "EMPRESA_WEB":       "www.innovacom.mx",
    "EMPRESA_REP_LEGAL": "RODRIGO CABRERA GONZALEZ",
}

def run(ssh, cmd):
    _, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err

def main():
    print(f"\nConectando a {USER}@{HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASS, timeout=20)
    except Exception as e:
        print(f"ERROR SSH: {e}")
        sys.exit(1)
    print("Conexion establecida.\n")

    print("=== Migracion de base de datos ===")
    for name, sql in STEPS:
        safe_sql = sql.replace("'", "\\'")
        cmd = f"mysql -u root -p'{PASS}' {DB} -e '{safe_sql}' 2>&1"
        out, err = run(ssh, cmd)
        combined = (out + err).lower()
        if "error" in combined and "duplicate" not in combined and "already exists" not in combined:
            print(f"  FAIL {name}: {(out or err)[:120]}")
        else:
            note = " (ya existia)" if ("duplicate" in combined or "already exists" in combined) else ""
            print(f"  OK   {name}{note}")

    print("\n=== Actualizando .env del servidor ===")
    env_path = "/var/www/dismed/backend/.env"
    current, _ = run(ssh, f"cat {env_path} 2>/dev/null || echo ''")

    for key, value in ENV_UPDATES.items():
        if f"{key}=" in current:
            run(ssh, f"sed -i 's|^{key}=.*|{key}={value}|' {env_path}")
            print(f"  OK   {key} actualizado")
        else:
            run(ssh, f"echo '{key}={value}' >> {env_path}")
            print(f"  OK   {key} agregado")

    print("\n=== Reiniciando backend (PM2) ===")
    out, _ = run(ssh, "pm2 restart dismed-api 2>&1 || pm2 restart all 2>&1")
    if "online" in out.lower() or "restarted" in out.lower() or out == "":
        print("  OK   Backend reiniciado")
    else:
        print(f"  INFO {out[:200]}")

    ssh.close()
    print("\nMigracion completada en produccion.\n")

if __name__ == "__main__":
    main()
