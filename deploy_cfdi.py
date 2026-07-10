#!/usr/bin/env python3
"""
deploy_cfdi.py — Despliegue QUIRÚRGICO del módulo de Descarga/Consulta de CFDI.

A diferencia de deploy_ssh.py + deploy.sh (que REGENERAN el .env y reimportan el
schema — destructivo en producción), este script solo:
  1. Sube los archivos nuevos/cambiados del backend y frontend.
  2. Sube la e.firma a <APP>/efirma y los JSON legacy a backend/data/legacy_cfdi.
  3. Instala las dependencias nuevas (sin tocar el resto).
  4. ANEXA las variables nuevas al .env existente (si faltan).
  5. Corre migrate_v13.js (idempotente) y la carga histórica legacy_cfdi_load.js.
  6. Reconstruye el frontend y reinicia PM2.
  7. Smoke test de /api/health y /api/cfdi/fiel.

Uso:  python deploy_cfdi.py            (despliegue completo)
      python deploy_cfdi.py --no-legacy   (omite la carga histórica)
Requisitos: pip install paramiko ; archivo .env.server con SERVER_*.
"""
import sys, os, posixpath
from pathlib import Path
import paramiko

ROOT = Path(__file__).parent.resolve()
NO_LEGACY = "--no-legacy" in sys.argv

def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg

cfg = load_env(ROOT / ".env.server")
HOST, USER, PWD = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]
APP = cfg.get("SERVER_APP_DIR", "/var/www/dismed")
BACK = f"{APP}/backend"
FRONT = f"{APP}/frontend"
EFIRMA = f"{APP}/efirma"

# Archivos a subir: (local, remote)
BACKEND_FILES = [
    "dismed/backend/src/app.js",
    "dismed/backend/migrate_v13.js",
    "dismed/backend/src/modules/cfdi/sat.fiel.js",
    "dismed/backend/src/modules/cfdi/sat.client.js",
    "dismed/backend/src/modules/cfdi/cfdi.parser.js",
    "dismed/backend/src/modules/cfdi/cfdi.repo.js",
    "dismed/backend/src/modules/cfdi/sat.descarga.service.js",
    "dismed/backend/src/modules/cfdi/cfdi.controller.js",
    "dismed/backend/src/modules/cfdi/cfdi.routes.js",
    "dismed/backend/src/modules/cfdi/sat.cron.js",
    "dismed/backend/scripts/legacy_cfdi_load.js",
    "dismed/backend/package.json",
]
FRONTEND_FILES = [
    "dismed/frontend/src/App.jsx",
    "dismed/frontend/src/components/layout/Sidebar.jsx",
    "dismed/frontend/src/pages/Cfdi/ConsultaCfdi.jsx",
]

def remote_path(local_rel):
    # 'dismed/backend/...' -> '<APP>/backend/...' ; 'dismed/frontend/...' -> '<APP>/frontend/...'
    rel = local_rel.replace("dismed/backend/", "").replace("dismed/frontend/", "")
    base = BACK if "dismed/backend/" in local_rel else FRONT
    return posixpath.join(base, rel)

def main():
    global BACK, FRONT, EFIRMA
    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    sftp = ssh.open_sftp()

    def exists(p):
        try: sftp.stat(p); return True
        except IOError: return False

    # Pre-flight: detectar rutas reales del backend/frontend en el VPS.
    if not exists(BACK):
        for c in ["/var/www/dismed/backend", "/root/dismed/backend"]:
            if exists(c): BACK = c; break
    if not exists(FRONT):
        for c in ["/var/www/dismed/frontend", "/root/dismed/frontend"]:
            if exists(c): FRONT = c; break
    EFIRMA = posixpath.join(posixpath.dirname(BACK), "efirma")
    print(f"  backend:  {BACK}")
    print(f"  frontend: {FRONT}")
    print(f"  efirma:   {EFIRMA}")
    if not exists(BACK) or not exists(FRONT):
        print("  ERROR: no encontré backend o frontend en el VPS. Revisa SERVER_APP_DIR en .env.server.")
        ssh.close(); sys.exit(1)
    if not exists(posixpath.join(BACK, ".env")):
        print(f"  ADVERTENCIA: no existe {BACK}/.env (¿ruta correcta?).")
    # Detectar nombre de la app PM2 (por si no es 'dismed-api').
    _, o, _ = ssh.exec_command("pm2 jlist 2>/dev/null | tr ',' '\\n' | grep -o '\"name\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4", timeout=30)
    PM2_APP = (o.read().decode().strip() or "dismed-api")
    print(f"  pm2 app:  {PM2_APP}")

    def run(cmd, label=None, timeout=1200):
        if label: print(f"\n▶ {label}")
        _, out, err = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
        for line in iter(out.readline, ""):
            print("  " + line.rstrip())
        code = out.channel.recv_exit_status()
        e = err.read().decode("utf-8", "replace")
        if code != 0:
            print(f"  [exit {code}] {e[:400]}")
        return code

    def mkdirs(remote_dir):
        parts = remote_dir.strip("/").split("/")
        cur = ""
        for p in parts:
            cur += "/" + p
            try: sftp.stat(cur)
            except IOError:
                try: sftp.mkdir(cur)
                except IOError: pass

    def put(local_rel, remote):
        lp = ROOT / local_rel
        if not lp.exists():
            print(f"  ! omitido (no existe local): {local_rel}"); return
        mkdirs(posixpath.dirname(remote))
        sftp.put(str(lp), remote)
        print(f"  ✓ {remote}")

    # 1. Backend + frontend files
    print("\n== Subiendo archivos backend ==")
    for f in BACKEND_FILES:
        put(f, remote_path(f))
    print("\n== Subiendo archivos frontend ==")
    for f in FRONTEND_FILES:
        put(f, remote_path(f))

    # 2. e.firma
    print("\n== Subiendo e.firma ==")
    mkdirs(EFIRMA)
    efirma_local = ROOT / "cfdi" / "efirma"
    for f in os.listdir(efirma_local):
        sftp.put(str(efirma_local / f), posixpath.join(EFIRMA, f))
        print(f"  ✓ {posixpath.join(EFIRMA, f)}")
    run(f"chmod 600 {EFIRMA}/*; chown -R root:root {EFIRMA} 2>/dev/null || true")

    # 3. JSON legacy
    if not NO_LEGACY:
        print("\n== Subiendo JSON legacy ==")
        ldir = ROOT / "dismed" / "backend" / "data" / "legacy_cfdi"
        rdir = f"{BACK}/data/legacy_cfdi"
        mkdirs(rdir)
        if ldir.exists():
            for f in os.listdir(ldir):
                if f.endswith(".json"):
                    sftp.put(str(ldir / f), posixpath.join(rdir, f))
                    print(f"  ✓ {f}")
        else:
            print("  ! No hay data/legacy_cfdi local (corre legacy_cfdi_extract.js en dev).")

    sftp.close()

    # 4. Dependencias nuevas
    run(f"cd {BACK} && PUPPETEER_SKIP_DOWNLOAD=true npm install @nodecfdi/sat-ws-descarga-masiva @nodecfdi/credentials fast-xml-parser node-cron --save 2>&1 | tail -8",
        "Instalando dependencias backend")

    # 5. Variables de entorno (anexar si faltan)
    run(
        f"cd {BACK} && "
        f"grep -q '^SAT_FIEL_DIR=' .env || echo 'SAT_FIEL_DIR={EFIRMA}' >> .env; "
        f"grep -q '^SAT_CRON_ENABLED=' .env || echo 'SAT_CRON_ENABLED=true' >> .env; "
        f"echo '--- vars SAT en .env ---'; grep -E '^SAT_' .env",
        "Configurando variables de entorno (.env)")

    # 6. Migración (idempotente)
    run(f"cd {BACK} && node migrate_v13.js", "Migración v13")

    # 7. Carga histórica legacy
    if not NO_LEGACY:
        run(f"cd {BACK} && node scripts/legacy_cfdi_load.js", "Carga histórica CFDI (legacy)", timeout=1800)

    # 8. Rebuild frontend
    run(f"cd {FRONT} && npm install --silent && npm run build 2>&1 | tail -6", "Build frontend", timeout=900)

    # 9. Reinicio PM2
    run(f"pm2 restart {PM2_APP} && sleep 2 && pm2 status {PM2_APP}", "Reiniciando backend (PM2)")

    # 10. Smoke test
    run("echo '--- health ---'; curl -s http://localhost:3001/api/health; echo; "
        "echo '--- conteo cfdi_repositorio ---'; "
        f"mysql -u {cfg.get('DB_USER','dismed_user')} -p'{cfg.get('DB_PASS','')}' {cfg.get('DB_NAME','dismed_db')} "
        "-e 'SELECT tipo, COUNT(*) n FROM cfdi_repositorio GROUP BY tipo;' 2>/dev/null",
        "Smoke test")

    ssh.close()
    print("\n== Despliegue CFDI terminado ==")
    print(f"   Verifica en: http://{HOST}/cfdi")

if __name__ == "__main__":
    main()
