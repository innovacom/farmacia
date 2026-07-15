#!/usr/bin/env python3
"""
deploy.py — DESPLIEGUE CANÓNICO de DISMED (incremental, seguro, idempotente).

ESTE es el único script de despliegue. No usar deploy.sh / deploy_ssh.py (esos
REGENERAN el .env y reimportan el schema: destructivos en producción).

Qué hace:
  1. Construye el frontend LOCALMENTE (nunca en el VPS).
  2. Sincroniza TODO el backend (src/, scripts/, migrate_v*.js, package.json) al VPS.
  3. `npm install` en el backend (toma dependencias nuevas si las hubiera).
  4. Reemplaza la dist servida por Apache (respaldando la anterior).
  5. Reinicia PM2 y recarga Apache. Smoke test (/api/health).

Qué NO hace (a propósito): NO toca el .env, NO reimporta el schema, NO corre
migraciones (esas se ejecutan aparte: `python deploy.py --migrar migrate_vXX.js`).

Usa UN canal SSH a la vez (el sshd del VPS limita canales concurrentes).
Lee credenciales de .env.server. Requiere: pip install paramiko.

Uso (en tu PowerShell, sin '!'):
  python deploy.py                          # despliegue normal (backend + frontend)
  python deploy.py --solo-frontend          # solo reconstruye y sube la dist
  python deploy.py --solo-backend           # solo backend (no toca la dist)
  python deploy.py --migrar migrate_v13.js  # despliega y además corre esa migración
"""
import sys, tarfile, posixpath, subprocess
from pathlib import Path
import paramiko

# La consola de Windows suele usar cp1252, que no puede imprimir ✓/✗ y tira
# UnicodeEncodeError a mitad del despliegue. Forzar UTF-8 en stdout/stderr.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.resolve()
BACK_LOCAL = ROOT / "dismed" / "backend"
FRONT_LOCAL = ROOT / "dismed" / "frontend"
DIST_LOCAL = FRONT_LOCAL / "dist"

ARGS = sys.argv[1:]
SOLO_FRONT = "--solo-frontend" in ARGS
SOLO_BACK = "--solo-backend" in ARGS
MIGRAR = ARGS[ARGS.index("--migrar") + 1] if "--migrar" in ARGS else None

# Qué del backend se sincroniza (relativo a dismed/backend). Excluye node_modules y .env.
BACK_INCLUDE_DIRS = ["src", "scripts"]
BACK_INCLUDE_GLOBS = ["migrate_v*.js", "package.json"]

def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg

cfg = load_env(ROOT / ".env.server")
HOST, USER, PWD = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]

def build_frontend():
    print("== Build frontend local ==")
    r = subprocess.run("npm run build", cwd=str(FRONT_LOCAL), shell=True)
    if r.returncode != 0 or not (DIST_LOCAL / "index.html").exists():
        print("ERROR: el build local falló. Aborto (no se sube nada)."); sys.exit(1)

def tar_backend():
    tgz = ROOT / "_deploy_backend.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for d in BACK_INCLUDE_DIRS:
            p = BACK_LOCAL / d
            if p.exists():
                for item in p.rglob("*"):
                    if "node_modules" in item.parts:
                        continue
                    tar.add(item, arcname=str(item.relative_to(BACK_LOCAL)).replace("\\", "/"), recursive=False)
        for g in BACK_INCLUDE_GLOBS:
            for item in BACK_LOCAL.glob(g):
                tar.add(item, arcname=item.name)
    return tgz

def tar_dist():
    tgz = ROOT / "_deploy_dist.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for item in DIST_LOCAL.rglob("*"):
            tar.add(item, arcname=str(item.relative_to(DIST_LOCAL)).replace("\\", "/"))
    return tgz

def main():
    if not SOLO_BACK:
        build_frontend()
    back_tgz = None if SOLO_FRONT else tar_backend()
    dist_tgz = None if SOLO_BACK else tar_dist()

    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)

    # Ejecuta un comando en UN canal y lo cierra (el sshd limita canales concurrentes).
    def run(cmd, timeout=900, show=True):
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

    # Detección de rutas (un solo canal).
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
    print(f"  backend = {BACK}\n  docroot = {DOCROOT}\n  pm2 app = {PM2_APP}")

    # Subida de tarballs (SFTP, luego cerrar).
    print("== Subiendo paquetes ==")
    sftp = ssh.open_sftp()
    if back_tgz: sftp.put(str(back_tgz), "/tmp/_deploy_backend.tgz"); print("  ✓ backend")
    if dist_tgz: sftp.put(str(dist_tgz), "/tmp/_deploy_dist.tgz"); print("  ✓ dist")
    sftp.close()

    # Backend: respaldar src, extraer, npm install.
    if back_tgz:
        print("== Backend: sincronizando + npm install ==")
        run(
            f"cp -a '{BACK}/src' '{BACK}/src.bak.$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true; "
            f"tar -xzf /tmp/_deploy_backend.tgz -C '{BACK}'; rm -f /tmp/_deploy_backend.tgz; "
            f"cd '{BACK}' && PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev 2>&1 | tail -4; echo 'backend OK'"
        )

    # Migración opcional.
    if MIGRAR:
        print(f"== Migración: {MIGRAR} ==")
        run(f"cd '{BACK}' && node {MIGRAR}")

    # Frontend: reemplazar dist.
    if dist_tgz:
        print("== Frontend: reemplazando dist ==")
        run(
            f"cp -a '{DOCROOT}' '{DOCROOT}.bak.$(date +%Y%m%d-%H%M%S)' 2>/dev/null || true; "
            f"rm -rf '{DOCROOT}'/*; tar -xzf /tmp/_deploy_dist.tgz -C '{DOCROOT}'; rm -f /tmp/_deploy_dist.tgz; echo 'dist OK'"
        )

    # Reinicio + recarga + smoke test.
    print("== Reinicio PM2 + Apache + smoke test ==")
    run(
        f"pm2 restart {PM2_APP} || pm2 restart all; sleep 2; pm2 list | grep -E 'name|{PM2_APP}|online|errored' | head -6; "
        f"apachectl configtest 2>&1 | tail -1; systemctl reload apache2 && echo APACHE_OK; "
        f"echo -n 'health: '; curl -s http://localhost:3001/api/health; echo"
    )

    ssh.close()
    for t in (back_tgz, dist_tgz):
        if t: t.unlink(missing_ok=True)
    print("\n== Despliegue terminado. Abre el sitio con Ctrl+F5. ==")

if __name__ == "__main__":
    main()
