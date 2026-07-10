#!/usr/bin/env python3
"""
DISMED - Despliegue SSH desde Windows a servidor Linux
Usa paramiko para autenticacion por password sin interaccion
Uso: python deploy_ssh.py
"""

import os
import sys
import stat
import time
import tarfile
import shutil
import tempfile
from pathlib import Path

# Forzar UTF-8 en la consola de Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    import paramiko
except ImportError:
    print("ERROR: Instala paramiko con:  pip install paramiko")
    sys.exit(1)

# ── Ruta del proyecto ──────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()

def load_env(filepath):
    """Lee archivo .env y retorna un dict."""
    cfg = {}
    with open(filepath, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, _, v = line.partition("=")
                cfg[k.strip()] = v.strip()
    return cfg

def create_package():
    """Empaqueta la carpeta dismed excluyendo node_modules, .env y dist."""
    pkg_path = SCRIPT_DIR / "dismed-deploy.tar.gz"
    dismed_src = SCRIPT_DIR / "dismed"
    deploy_sh  = SCRIPT_DIR / "deploy.sh"

    EXCLUDE_DIRS  = {"node_modules", ".git", "dist", "__pycache__"}
    EXCLUDE_FILES = {".env", ".DS_Store"}
    EXCLUDE_EXTS  = {".log", ".pid"}

    def should_exclude(path: Path) -> bool:
        if path.name in EXCLUDE_DIRS and path.is_dir():
            return True
        if path.name in EXCLUDE_FILES:
            return True
        if path.suffix in EXCLUDE_EXTS:
            return True
        # Excluir node_modules en cualquier nivel
        parts = path.parts
        return any(p in EXCLUDE_DIRS for p in parts)

    print("▶ Empaquetando aplicacion (excluyendo node_modules)...")
    with tarfile.open(pkg_path, "w:gz") as tar:
        # Agregar deploy.sh
        tar.add(deploy_sh, arcname="deploy.sh")

        # Agregar dismed/ excluyendo directorios/archivos no deseados
        for item in sorted(dismed_src.rglob("*")):
            # Verificar si algun componente del path relativo debe excluirse
            try:
                rel = item.relative_to(SCRIPT_DIR)
            except ValueError:
                continue
            if should_exclude(item):
                continue
            arcname = str(rel).replace("\\", "/")
            tar.add(item, arcname=arcname, recursive=False)

    size_mb = pkg_path.stat().st_size / (1024 * 1024)
    print(f"  Paquete: {pkg_path.name} ({size_mb:.1f} MB)")
    return pkg_path

def run_cmd(ssh: paramiko.SSHClient, cmd: str, timeout: int = 900) -> tuple[int, str, str]:
    """Ejecuta un comando SSH y retorna (exit_code, stdout, stderr)."""
    stdin_, stdout_, stderr_ = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
    # Leer salida en tiempo real
    output_lines = []
    while True:
        line = stdout_.readline()
        if not line:
            break
        line = line.rstrip("\r\n")
        print(f"  {line}")
        output_lines.append(line)
    exit_code = stdout_.channel.recv_exit_status()
    err = "".join(stderr_.readlines())
    return exit_code, "\n".join(output_lines), err

def upload_file(sftp: paramiko.SFTPClient, local: Path, remote: str):
    """Sube un archivo con barra de progreso simple."""
    size = local.stat().st_size

    def progress(sent, total):
        pct = int(sent * 100 / total)
        bar = "#" * (pct // 5) + "-" * (20 - pct // 5)
        print(f"\r  Subiendo [{bar}] {pct}%", end="", flush=True)

    sftp.put(str(local), remote, callback=progress)
    print()

def build_env_exports(cfg: dict) -> str:
    """Genera los export VAR='value' para el shell remoto."""
    keys = [
        ("APP_DIR",           "SERVER_APP_DIR"),
        ("PKG_DIR",           None),            # valor fijo
        ("DB_NAME",           "DB_NAME"),
        ("DB_USER",           "DB_USER"),
        ("DB_PASS",           "DB_PASS"),
        ("JWT_SECRET",        "JWT_SECRET"),
        ("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
        ("EMPRESA_NOMBRE",    "EMPRESA_NOMBRE"),
        ("EMPRESA_RFC",       "EMPRESA_RFC"),
        ("EMPRESA_TELEFONO",  "EMPRESA_TELEFONO"),
        ("EMPRESA_EMAIL",     "EMPRESA_EMAIL"),
        ("EMPRESA_DIRECCION", "EMPRESA_DIRECCION"),
        ("EMPRESA_WEB",       "EMPRESA_WEB"),
        ("EMPRESA_REP_LEGAL", "EMPRESA_REP_LEGAL"),
        ("SERVER_HOST",       "SERVER_HOST"),
        ("SMTP_HOST",         "SMTP_HOST"),
        ("SMTP_PORT",         "SMTP_PORT"),
        ("SMTP_USER",         "SMTP_USER"),
        ("SMTP_PASS",         "SMTP_PASS"),
    ]
    exports = []
    for env_var, cfg_key in keys:
        if cfg_key is None:
            val = "/tmp/dismed-pkg"
        else:
            val = cfg.get(cfg_key, "")
        # Escapar comillas simples en el valor
        val = val.replace("'", "'\\''")
        exports.append(f"export {env_var}='{val}'")
    return "\n".join(exports)


def main():
    print()
    print("=" * 54)
    print("  DISMED - Despliegue a servidor de produccion")
    print("=" * 54)
    print()

    # ── Leer .env.server ──────────────────────────────────────
    env_file = SCRIPT_DIR / ".env.server"
    if not env_file.exists():
        print(f"ERROR: No se encontro {env_file}")
        sys.exit(1)

    cfg = load_env(env_file)
    host = cfg["SERVER_HOST"]
    user = cfg["SERVER_USER"]
    pwd  = cfg["SERVER_PASS"]
    print(f"Servidor: {user}@{host}")
    print(f"App dir:  {cfg.get('SERVER_APP_DIR', '/var/www/dismed')}")
    print()

    # ── Crear paquete ─────────────────────────────────────────
    pkg_path = create_package()
    print()

    # ── Conectar SSH ──────────────────────────────────────────
    print(f"▶ Conectando a {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=user, password=pwd, timeout=30)
    except Exception as e:
        print(f"ERROR SSH: {e}")
        pkg_path.unlink(missing_ok=True)
        sys.exit(1)
    print("  Conexion establecida.")

    sftp = ssh.open_sftp()
    remote_pkg = f"/tmp/dismed-deploy.tar.gz"

    try:
        # ── Subir paquete ─────────────────────────────────────
        print()
        print(f"▶ Subiendo paquete al servidor...")
        upload_file(sftp, pkg_path, remote_pkg)
        print("  Subida completada.")
        sftp.close()

        # ── Preparar variables de entorno ─────────────────────
        env_exports = build_env_exports(cfg)

        install_cmd = f"""
set -e
mkdir -p /tmp/dismed-pkg
tar -xzf {remote_pkg} -C /tmp/dismed-pkg
{env_exports}
sudo -E bash /tmp/dismed-pkg/deploy.sh
"""

        # ── Ejecutar instalacion ──────────────────────────────
        print()
        print("▶ Ejecutando instalacion en el servidor...")
        print("  (Puede tardar 5-15 minutos, se muestra el progreso)")
        print()
        exit_code, out, err = run_cmd(ssh, install_cmd, timeout=900)

        print()
        if exit_code == 0:
            print("=" * 54)
            print("  DISMED desplegado correctamente")
            print("=" * 54)
            print()
            print(f"  URL del sistema:  http://{host}")
            print(f"  API health:       http://{host}/api/health")
            print( "  Usuario admin:    admin@dismed.mx")
            print( "  Password inicial: Admin1234!")
            print()
            print("  IMPORTANTE:")
            print("  1. Cambia la password del admin en el primer login")
            print("  2. Agrega tu ANTHROPIC_API_KEY:")
            print(f"     ssh {user}@{host}")
            print(f"     nano {cfg.get('SERVER_APP_DIR', '/var/www/dismed')}/backend/.env")
            print( "     pm2 restart dismed-api")
            print()
        else:
            print("ERROR: El script de instalacion termino con errores.")
            if err:
                print(f"Stderr: {err[:500]}")
            print()
            print("Para ver logs completos:")
            print(f"  ssh {user}@{host} 'pm2 logs dismed-api --lines 50'")

        # ── Limpiar servidor ──────────────────────────────────
        print("▶ Limpiando archivos temporales del servidor...")
        run_cmd(ssh, f"rm -rf /tmp/dismed-pkg {remote_pkg}", timeout=30)

    finally:
        ssh.close()
        pkg_path.unlink(missing_ok=True)

    print("  Listo.")
    print()


if __name__ == "__main__":
    main()
