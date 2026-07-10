#!/usr/bin/env python3
"""
recuperar_frontend.py — Restaura el frontend COMPLETO en el VPS.

El deploy reconstruyó el frontend en el servidor y dejó una `dist` reducida.
Este script construye el frontend LOCALMENTE (fuente completa y verificada) y
sube esa `dist` ya compilada al DocumentRoot real de Apache (auto-detectado),
respaldando la anterior y recargando Apache. NO reconstruye en el VPS.

Uso:  python recuperar_frontend.py
"""
import sys, tarfile, posixpath, subprocess
from pathlib import Path
import paramiko

ROOT = Path(__file__).parent.resolve()
FRONT_LOCAL = ROOT / "dismed" / "frontend"
DIST_LOCAL = FRONT_LOCAL / "dist"

def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg

cfg = load_env(ROOT / ".env.server")
HOST, USER, PWD = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]

def build_local():
    print("== Construyendo frontend localmente (npm run build) ==")
    r = subprocess.run("npm run build", cwd=str(FRONT_LOCAL), shell=True)
    if r.returncode != 0 or not (DIST_LOCAL / "index.html").exists():
        print("ERROR: el build local falló."); sys.exit(1)
    print("  build OK")

def make_tar():
    tgz = ROOT / "dist_recovery.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for item in DIST_LOCAL.rglob("*"):
            tar.add(item, arcname=str(item.relative_to(DIST_LOCAL)).replace("\\", "/"))
    print(f"  empaquetado: {tgz.name} ({tgz.stat().st_size//1024} KB)")
    return tgz

def main():
    build_local()
    tgz = make_tar()

    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)

    def run(cmd, timeout=300):
        _, out, err = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
        txt = ""
        for line in iter(out.readline, ""):
            print("  " + line.rstrip()); txt += line
        out.channel.recv_exit_status()
        return txt

    # Detectar DocumentRoot real (la línea que apunte a un .../dist)
    print("== Detectando DocumentRoot de Apache ==")
    docroot = run("grep -rhI 'DocumentRoot' /etc/apache2/sites-enabled/ 2>/dev/null | awk '{print $2}' | grep -i dist | head -1").strip()
    if not docroot:
        docroot = "/var/www/dismed/frontend/dist"
        print(f"  (no detectado, uso por defecto) {docroot}")
    else:
        print(f"  DocumentRoot: {docroot}")

    # Subir el tarball
    print("== Subiendo dist compilada ==")
    sftp = ssh.open_sftp()
    sftp.put(str(tgz), "/tmp/dist_recovery.tgz")
    sftp.close()
    print("  subido a /tmp/dist_recovery.tgz")

    # Respaldar, reemplazar y recargar
    ts = "bak.$(date +%Y%m%d-%H%M%S)"
    print("== Reemplazando dist y recargando Apache ==")
    run(
        f"set -e; "
        f"mkdir -p '{docroot}'; "
        f"cp -a '{docroot}' '{docroot}.{ts}' 2>/dev/null || true; "
        f"rm -rf '{docroot}'/*; "
        f"tar -xzf /tmp/dist_recovery.tgz -C '{docroot}'; "
        f"rm -f /tmp/dist_recovery.tgz; "
        f"echo '--- contenido nuevo ---'; ls '{docroot}'; "
        f"echo '--- assets ---'; ls '{docroot}/assets' 2>/dev/null | head; "
        f"apachectl configtest 2>&1 | tail -1; systemctl reload apache2 && echo 'APACHE_RELOAD_OK'"
    )

    ssh.close()
    tgz.unlink(missing_ok=True)
    print("\n== Frontend restaurado. Abre el sitio con Ctrl+F5 (recarga forzada). ==")

if __name__ == "__main__":
    main()
