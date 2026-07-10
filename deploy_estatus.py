#!/usr/bin/env python3
"""
deploy_estatus.py — Despliega: estatus vigente/cancelado (metadata SAT) + rango de
fechas en la descarga manual. Seguro y mínimo (no reconstruye en el VPS).

Sube los controllers/servicios del backend CFDI + la dist del frontend, reinicia
PM2 y recarga Apache. Usa UN canal SSH a la vez.

Uso (en tu PowerShell, sin '!'):  python deploy_estatus.py
"""
import sys, tarfile, posixpath, subprocess
from pathlib import Path
import paramiko

ROOT = Path(__file__).parent.resolve()
FRONT_LOCAL = ROOT / "dismed" / "frontend"
DIST_LOCAL = FRONT_LOCAL / "dist"

BACKEND_FILES = [
    "dismed/backend/src/modules/cfdi/sat.client.js",
    "dismed/backend/src/modules/cfdi/sat.descarga.service.js",
    "dismed/backend/src/modules/cfdi/cfdi.controller.js",
    "dismed/backend/src/modules/cfdi/cfdi.routes.js",
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

    tgz = ROOT / "dist_estatus.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for item in DIST_LOCAL.rglob("*"):
            tar.add(item, arcname=str(item.relative_to(DIST_LOCAL)).replace("\\", "/"))

    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)

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
        chan.recv_exit_status(); chan.close()
        txt = out.decode("utf-8", "replace")
        if show:
            for line in txt.splitlines():
                print("  " + line)
        return txt

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
    print(f"  backend={BACK}\n  docroot={DOCROOT}\n  pm2={PM2_APP}")

    print("== Subiendo backend + dist ==")
    sftp = ssh.open_sftp()
    for f in BACKEND_FILES:
        dest = posixpath.join(BACK, f.replace("dismed/backend/", ""))
        sftp.put(str(ROOT / f), dest)
        print(f"  ✓ {dest}")
    sftp.put(str(tgz), "/tmp/dist_estatus.tgz")
    sftp.close()

    print("== Reemplazando dist + restart + reload ==")
    run(
        f"echo -n 'metadata reader: '; grep -c leerMetadataDeZip '{BACK}/src/modules/cfdi/sat.client.js'; "
        f"cp -a '{DOCROOT}' '{DOCROOT}.bak.$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true; "
        f"rm -rf '{DOCROOT}'/*; tar -xzf /tmp/dist_estatus.tgz -C '{DOCROOT}'; rm -f /tmp/dist_estatus.tgz; "
        f"pm2 restart {PM2_APP} || pm2 restart all; sleep 2; pm2 list; "
        f"apachectl configtest 2>&1 | tail -1; systemctl reload apache2 && echo APACHE_OK; "
        f"echo -n 'health: '; curl -s http://localhost:3001/api/health; echo"
    )

    ssh.close()
    tgz.unlink(missing_ok=True)
    print("\n== Listo. Ctrl+F5 en el navegador. ==")

if __name__ == "__main__":
    main()
