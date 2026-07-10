#!/usr/bin/env python3
"""
Fix MariaDB root en Debian 12 (MariaDB 10.4+).
Ejecuta FLUSH PRIVILEGES + ALTER USER en UNA SOLA conexion mientras
el servidor esta en modo skip-grant-tables.
"""
import sys, time, paramiko

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DB_NAME = "dismed_db"
DB_USER = "dismed_user"
DB_PASS = "Y8XSSmUjLrsiben0bJWJ"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("72.249.60.175", username="root", password="GaPaPaRoEl1", timeout=20)
print("Conectado al servidor.")

def run(cmd, timeout=60):
    _, out, err = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
    o = out.read().decode("utf-8", errors="replace").strip()
    rc = out.channel.recv_exit_status()
    return rc, o

def run2(cmd, timeout=60):
    """Sin PTY, captura stdout y stderr por separado."""
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", errors="replace").strip()
    e = err.read().decode("utf-8", errors="replace").strip()
    rc = out.channel.recv_exit_status()
    return rc, o, e

# ── 1. Verificar estado actual ─────────────────────────────────
print("\n[1] Estado actual de MariaDB...")
rc, o = run("systemctl is-active mariadb && echo ACTIVE || echo INACTIVE")
print(f"   Servicio: {o}")

# Verificar si hay un skip-grant override activo
override = "/etc/systemd/system/mariadb.service.d/skip-grant.conf"
rc, o = run(f"[ -f {override} ] && echo HAY_OVERRIDE || echo SIN_OVERRIDE")
print(f"   Override previo: {o}")
if "HAY_OVERRIDE" in o:
    run(f"rm -f {override} && systemctl daemon-reload && systemctl restart mariadb")
    time.sleep(5)

# ── 2. Activar skip-grant-tables ──────────────────────────────
print("\n[2] Activando skip-grant-tables via systemd...")
override_content = "[Service]\nExecStart=\nExecStart=/usr/sbin/mariadbd --skip-grant-tables --skip-networking\n"

cmd_create_override = (
    f"mkdir -p $(dirname {override}) && "
    f"printf '{override_content}' > {override} && "
    "systemctl daemon-reload && "
    "systemctl restart mariadb"
)
rc, o = run(cmd_create_override, timeout=30)
print(f"   rc={rc}  {o[:100]}")
time.sleep(10)

rc, o = run("systemctl is-active mariadb")
print(f"   Estado: {o}")

# ── 3. FLUSH + ALTER en UNA sola conexion ────────────────────
print("\n[3] FLUSH + ALTER USER en una sola conexion MySQL...")

# Este es el SQL que se ejecutara todo de corrido en una conexion
sql_block = """FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket;
FLUSH PRIVILEGES;"""

# Escribir el SQL a un archivo en el servidor y ejecutarlo
rc, o = run(f"printf '%s' \"{sql_block}\" > /tmp/reset_root.sql", timeout=10)

# Ejecutar con mysql (una sola conexion, lee del archivo)
rc, o, e = run2("mysql -u root < /tmp/reset_root.sql 2>&1")
print(f"   rc={rc}  stdout={o[:300]}  stderr={e[:300]}")

# Si falla, intentar con UPDATE en global_priv (alternativa MariaDB 10.4+)
if rc != 0:
    print("   Intentando via mysql.global_priv (MariaDB 10.4+)...")
    sql_global_priv = """FLUSH PRIVILEGES;
UPDATE mysql.global_priv SET priv=JSON_SET(priv,'$.plugin','unix_socket','$.authentication_string','') WHERE User='root' AND Host='localhost';
FLUSH PRIVILEGES;"""
    rc, o = run(f"printf '%s' \"{sql_global_priv}\" > /tmp/reset_root2.sql", timeout=10)
    rc, o, e = run2("mysql -u root < /tmp/reset_root2.sql 2>&1")
    print(f"   global_priv rc={rc}  {o[:200]}  {e[:200]}")

# Limpiar archivos temporales
run("rm -f /tmp/reset_root.sql /tmp/reset_root2.sql")

# ── 4. Quitar override y reiniciar normal ─────────────────────
print("\n[4] Reiniciando MariaDB con configuracion normal...")
rc, o = run(f"rm -f {override} && systemctl daemon-reload && systemctl restart mariadb", timeout=30)
print(f"   rc={rc}  {o[:100]}")
time.sleep(8)

# ── 5. Verificar acceso root sin password ─────────────────────
print("\n[5] Verificando acceso root (unix_socket, sin password)...")
rc, o, e = run2("mysql -e 'SELECT VERSION();' 2>&1")
print(f"   rc={rc}  out={o[:200]}  err={e[:200]}")

if rc != 0:
    print("\nERROR: Acceso root fallido. Verificando logs...")
    rc2, o2 = run("journalctl -u mariadb -n 15 --no-pager 2>&1")
    print(o2[-600:])

    # Ultimo intento: mostrar plugin actual
    rc3, o3 = run("mysql -e 'SELECT User,Host,plugin FROM mysql.user WHERE User=\"root\";' 2>&1 || echo FAIL")
    print(f"   plugin root: {o3}")
    ssh.close()
    sys.exit(1)

MYSQL_CMD = "mysql"

# ── 6. Crear base de datos y usuario ─────────────────────────
print(f"\n[6] Creando BD '{DB_NAME}' y usuario '{DB_USER}'...")
setup_sql = (
    f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
    f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "
    f"CREATE USER IF NOT EXISTS '{DB_USER}'@'localhost' IDENTIFIED BY '{DB_PASS}'; "
    f"GRANT ALL PRIVILEGES ON `{DB_NAME}`.* TO '{DB_USER}'@'localhost'; "
    f"FLUSH PRIVILEGES;"
)
rc, o, e = run2(f"{MYSQL_CMD} << 'SQLEOF'\n{setup_sql}\nSQLEOF")
print(f"   rc={rc}  {o[:200]}  {e[:200]}")

# ── 7. Verificar acceso del usuario app ───────────────────────
print(f"\n[7] Verificando acceso de '{DB_USER}'@'{DB_NAME}'...")
rc, o, e = run2(f"mysql -u {DB_USER} -p'{DB_PASS}' {DB_NAME} -e 'SHOW TABLES;' 2>&1")
print(f"   rc={rc}  {o[:200]}  {e[:200]}")

if rc == 0:
    print("\n✅ Base de datos configurada correctamente.")
    print(f"   Proximos pasos: ejecuta python deploy_ssh.py para continuar el deploy.")
else:
    print(f"\n❌ Error verificando acceso de la app.")

ssh.close()
