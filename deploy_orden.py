#!/usr/bin/env python3
"""
deploy_orden.py — Despliegue de la función "ordenar columnas" en consultas.

SEGURO y mínimo (no reconstruye en el VPS, no toca .env ni el schema):
  1. Construye el frontend LOCALMENTE.
  2. Sube los 2 controllers del backend (consultas + cfdi) y la `dist` compilada.
  3. Reemplaza la `dist` servida por Apache (respaldando la previa).
  4. Reinicia PM2 y recarga Apache. Smoke test.

Importante: usa UN canal SSH a la vez (el sshd del VPS limita canales concurrentes).

Uso (en tu PowerShell, sin '!'):  python deploy_orden.py
"""
import sys, tarfile, posixpath, subprocess
from pathlib import Path
import paramiko

ROOT = Path(__file__).parent.resolve()
FRONT_LOCAL = ROOT / "dismed" / "frontend"
DIST_LOCAL = FRONT_LOCAL / "dist"

BACKEND_FILES = [
    "dismed/backend/src/modules/consultas/consultas.controller.js",
    "dismed/backend/src/modules/cfdi/cfdi.controller.js",
]

def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg

cfg = load_env(ROOT / ".env.server")
HOST, USER, PWD = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]

def main():
    print("== Build frontend local ==")
    r = subprocess.run("npm run build", cwd=str(FRONT_LOCAL), shell=True)
    if r.returncode != 0 or not (DIST_LOCAL / "index.html").exists():
        print("ERROR: build local falló."); sys.exit(1)

    tgz = ROOT / "dist_orden.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for item in DIST_LOCAL.rglob("*"):
            tar.add(item, arcname=str(item.relative_to(DIST_LOCAL)).replace("\\", "/"))

    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)

    # Ejecuta un comando, imprime y devuelve la salida. Cierra el canal al terminar.
    def run(cmd, timeout=600, show=True):
        chan = ssh.get_transport().open_session(timeout=timeout)
        chan.exec_command(cmd)
        out = b""
        while True:
            if chan.recv_ready():
                out += chan.recv(65536)
            if chan.exit_status_ready() and not chan.recv_ready():
                break
        while chan.recv_ready():
            out += chan.recv(65536)
        chan.recv_exit_status()
        chan.close()
        txt = out.decode("utf-8", "replace")
        if show:
            for line in txt.splitlines():
                print("  " + line)
        return txt

    # --- FASE 1: detección (un solo canal) ---
    print("== Detectando rutas (backend / docroot / pm2) ==")
    det = run(
        'for d in /var/www/dismed/backend /root/dismed/backend; do [ -d "$d" ] && echo "BACK=$d" && break; done; '
        'DR=$(grep -rhI DocumentRoot /etc/apache2/sites-enabled/ 2>/dev/null | awk "{print \\$2}" | grep -i dist | head -1); '
        'echo "DOCROOT=${DR:-/var/www/dismed/frontend/dist}"; '
        'APP=$(pm2 jlist 2>/dev/null | tr "," "\\n" | grep -o "\\"name\\":\\"[^\\"]*\\"" | head -1 | cut -d "\\"" -f4); '
        'echo "PM2=${APP:-dismed-api}"',
        show=False,
    )
    vals = dict(l.split("=", 1) for l in det.splitlines() if "=" in l)
    BACK = vals.get("BACK", "/var/www/dismed/backend")
    DOCROOT = vals.get("DOCROOT", "/var/www/dismed/frontend/dist")
    PM2_APP = vals.get("PM2", "dismed-api")
    print(f"  backend = {BACK}")
    print(f"  docroot = {DOCROOT}")
    print(f"  pm2 app = {PM2_APP}")

    # --- FASE 2: subir archivos (SFTP, luego cerrar) ---
    print("== Subiendo controllers + dist ==")
    sftp = ssh.open_sftp()
    for f in BACKEND_FILES:
        dest = posixpath.join(BACK, f.replace("dismed/backend/", ""))
        sftp.put(str(ROOT / f), dest)
        print(f"  ✓ {dest}")
    sftp.put(str(tgz), "/tmp/dist_orden.tgz")
    print("  ✓ /tmp/dist_orden.tgz")
    sftp.close()

    # --- FASE 3: verificar, reemplazar dist, reiniciar (canales secuenciales) ---
    print("== Verificando que el código nuevo llegó al backend que corre ==")
    run(
        f"echo -n 'consultas sortCols: '; grep -c sortCols '{BACK}/src/modules/consultas/consultas.controller.js'; "
        f"echo -n 'cfdi SORT_COMP: '; grep -c SORT_COMP '{BACK}/src/modules/cfdi/cfdi.controller.js'; "
        f"echo -n 'pm2 cwd: '; pm2 jlist | tr ',' '\\n' | grep -m1 pm_cwd"
    )
    print("== Reemplazando dist ==")
    run(
        f"cp -a '{DOCROOT}' '{DOCROOT}.bak.$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true; "
        f"rm -rf '{DOCROOT}'/*; tar -xzf /tmp/dist_orden.tgz -C '{DOCROOT}'; rm -f /tmp/dist_orden.tgz; echo 'dist OK'"
    )
    print("== Reiniciando PM2 y recargando Apache ==")
    run(
        f"pm2 restart {PM2_APP} || pm2 reload {PM2_APP} || pm2 restart all; sleep 2; pm2 list; "
        f"apachectl configtest 2>&1 | tail -1; systemctl reload apache2 && echo APACHE_OK; "
        f"echo -n 'health: '; curl -s http://localhost:3001/api/health; echo"
    )

    ssh.close()
    tgz.unlink(missing_ok=True)
    print("\n== Listo. Abre el sitio con Ctrl+F5 y prueba ordenar (clic en los encabezados). ==")

if __name__ == "__main__":
    main()
