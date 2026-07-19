#!/usr/bin/env python3
"""
deploy_instancia.py — despliega el MISMO código de dismed/ a la instancia <slug>.

Por qué existe: cada farmacia/cliente que usa el sistema necesita su propio
ambiente (BD, sesiones, uploads y branding aislados), pero NO su propio
código. La primera instancia (farmacia.innovacom.mx) se creó por error como
una copia de código en una carpeta aparte ("claude/farmacia/") — cualquier
fix en dismed/ nunca se reflejaba ahí y viceversa. Este script reemplaza esa
idea: una sola base de código (dismed/, este repo), N instancias desplegadas
a distintos puertos/PM2/BD en el mismo VPS.

Dos modos:

  1) Sync normal (instancia YA aprovisionada) — igual que deploy.py pero
     apuntando a /var/www/<slug>/ en vez de /var/www/dismed/. NO toca .env
     ni datos.
       python deploy_instancia.py farmacia
       python deploy_instancia.py farmacia --solo-backend
       python deploy_instancia.py farmacia --migrar migrate_v30.js
       python deploy_instancia.py farmacia --migrar-todas   (corre migrate_v2..vN
         en orden; los scripts son idempotentes, no rompen nada si ya se aplicaron)

  2) Aprovisionar instancia NUEVA desde cero (BD+usuario, .env, PM2, Apache,
     SSL, schema limpio + admin):
       python deploy_instancia.py nueva_farmacia --nueva --dominio nuevafarmacia.innovacom.mx --puerto 3003

     El schema se copia (sin datos) de la BD de dismed_db EN VIVO vía
     `mysqldump --no-data --routines --triggers`, así que siempre incluye
     todas las migraciones ya aplicadas en producción — no hace falta re-jugar
     migrate_v2..vN uno por uno para una instancia nueva.

Requiere .env.server en la raíz (mismas credenciales SSH que deploy.py — root
en el mismo VPS 72.249.60.175). Requiere: pip install paramiko.
"""
import sys, os, json, secrets, tarfile, subprocess
from pathlib import Path
import paramiko

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.resolve()
BACK_LOCAL = ROOT / "dismed" / "backend"
FRONT_LOCAL = ROOT / "dismed" / "frontend"
DIST_LOCAL = FRONT_LOCAL / "dist"
REGISTRY = ROOT / "instancias.json"

BACK_INCLUDE_DIRS = ["src", "scripts"]
BACK_INCLUDE_GLOBS = ["migrate_v*.js", "package.json"]

ARGS = sys.argv[1:]
if not ARGS or ARGS[0].startswith("--"):
    print(__doc__); sys.exit(1)
SLUG = ARGS[0]
REST = ARGS[1:]

SOLO_FRONT = "--solo-frontend" in REST
SOLO_BACK = "--solo-backend" in REST
MIGRAR = REST[REST.index("--migrar") + 1] if "--migrar" in REST else None
MIGRAR_TODAS = "--migrar-todas" in REST
NUEVA = "--nueva" in REST
DOMINIO = REST[REST.index("--dominio") + 1] if "--dominio" in REST else None
PUERTO = REST[REST.index("--puerto") + 1] if "--puerto" in REST else None


def load_env(fp):
    cfg = {}
    for line in open(fp, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); cfg[k.strip()] = v.strip()
    return cfg


cfg = load_env(ROOT / ".env.server")
HOST, USER, PWD = cfg["SERVER_HOST"], cfg["SERVER_USER"], cfg["SERVER_PASS"]


def load_registry():
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text(encoding="utf-8"))
    return {}


def save_registry(reg):
    REGISTRY.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_frontend():
    print("== Build frontend local ==")
    r = subprocess.run("npm run build", cwd=str(FRONT_LOCAL), shell=True)
    if r.returncode != 0 or not (DIST_LOCAL / "index.html").exists():
        print("ERROR: el build local falló. Aborto (no se sube nada)."); sys.exit(1)


def tar_backend():
    tgz = ROOT / f"_deploy_backend_{SLUG}.tgz"
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
    tgz = ROOT / f"_deploy_dist_{SLUG}.tgz"
    with tarfile.open(tgz, "w:gz") as tar:
        for item in DIST_LOCAL.rglob("*"):
            tar.add(item, arcname=str(item.relative_to(DIST_LOCAL)).replace("\\", "/"))
    return tgz


def connect():
    print(f"== Conectando a {USER}@{HOST} ==")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PWD, timeout=30)
    return ssh


def make_run(ssh):
    # UN canal a la vez (el sshd del VPS limita canales concurrentes).
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
    return run


MIGRACIONES_ORDEN = [f"migrate_v{n}.js" for n in range(2, 31)]


def modo_sync():
    """Sincroniza código a una instancia YA aprovisionada. No toca .env ni datos."""
    if not SOLO_BACK:
        build_frontend()
    back_tgz = None if SOLO_FRONT else tar_backend()
    dist_tgz = None if SOLO_BACK else tar_dist()

    ssh = connect()
    run = make_run(ssh)

    det = run(
        f'for d in /var/www/{SLUG}/backend /root/{SLUG}/backend; do [ -d "$d" ] && echo "BACK=$d" && break; done; '
        f'DR=$(grep -rhI DocumentRoot /etc/apache2/sites-enabled/*{SLUG}* 2>/dev/null | awk "{{print \\$2}}" | grep -i dist | head -1); '
        f'echo "DOCROOT=${{DR:-/var/www/{SLUG}/frontend/dist}}"; '
        f'APP=$(pm2 jlist 2>/dev/null | tr "," "\\n" | grep -o "\\"name\\":\\"[^\\"]*{SLUG}[^\\"]*\\"" | head -1 | cut -d "\\"" -f4); '
        f'echo "PM2=${{APP:-{SLUG}-api}}"',
        show=False,
    )
    vals = dict(l.split("=", 1) for l in det.splitlines() if "=" in l)
    BACK = vals.get("BACK", f"/var/www/{SLUG}/backend")
    DOCROOT = vals.get("DOCROOT", f"/var/www/{SLUG}/frontend/dist")
    PM2_APP = vals.get("PM2", f"{SLUG}-api")

    if run(f"[ -d '{BACK}' ] && echo OK || echo MISSING", show=False).strip() != "OK":
        print(f"ERROR: no existe {BACK} en el VPS. ¿La instancia '{SLUG}' ya está aprovisionada?")
        print(f"       Si es nueva, usa: python deploy_instancia.py {SLUG} --nueva --dominio ... --puerto ...")
        ssh.close(); sys.exit(1)

    print(f"  backend = {BACK}\n  docroot = {DOCROOT}\n  pm2 app = {PM2_APP}")

    print("== Subiendo paquetes ==")
    sftp = ssh.open_sftp()
    if back_tgz: sftp.put(str(back_tgz), f"/tmp/_deploy_backend_{SLUG}.tgz"); print("  ok backend")
    if dist_tgz: sftp.put(str(dist_tgz), f"/tmp/_deploy_dist_{SLUG}.tgz"); print("  ok dist")
    sftp.close()

    if back_tgz:
        print("== Backend: sincronizando + npm install ==")
        run(
            f"cp -a '{BACK}/src' \"{BACK}/src.bak.$(date +%Y%m%d-%H%M%S)\" 2>/dev/null || true; "
            f"tar -xzf /tmp/_deploy_backend_{SLUG}.tgz -C '{BACK}'; rm -f /tmp/_deploy_backend_{SLUG}.tgz; "
            f"cd '{BACK}' && PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev 2>&1 | tail -4; echo 'backend OK'"
        )

    if MIGRAR:
        print(f"== Migración: {MIGRAR} ==")
        run(f"cd '{BACK}' && node {MIGRAR}")

    if MIGRAR_TODAS:
        print("== Corriendo migrate_v2..v30 en orden (idempotentes) ==")
        for m in MIGRACIONES_ORDEN:
            existe = run(f"[ -f '{BACK}/{m}' ] && echo SI || echo NO", show=False).strip()
            if existe != "SI":
                continue
            print(f"  -- {m} --")
            run(f"cd '{BACK}' && node {m}")

    if dist_tgz:
        print("== Frontend: reemplazando dist ==")
        run(
            f"cp -a '{DOCROOT}' \"{DOCROOT}.bak.$(date +%Y%m%d-%H%M%S)\" 2>/dev/null || true; "
            f"rm -rf '{DOCROOT}'/*; tar -xzf /tmp/_deploy_dist_{SLUG}.tgz -C '{DOCROOT}'; rm -f /tmp/_deploy_dist_{SLUG}.tgz; echo 'dist OK'"
        )

    print("== Reinicio PM2 + Apache + smoke test ==")
    puerto = vals.get("PORT")
    if not puerto:
        # Intenta leer el puerto real del .env de la instancia para el smoke test.
        puerto = run(f"grep -m1 '^PORT=' '{BACK}/.env' 2>/dev/null | cut -d= -f2", show=False).strip() or "3001"
    run(
        f"pm2 restart {PM2_APP} || pm2 restart all; sleep 2; pm2 list | grep -E 'name|{PM2_APP}|online|errored' | head -6; "
        f"apachectl configtest 2>&1 | tail -1; systemctl reload apache2 && echo APACHE_OK; "
        f"echo -n 'health: '; curl -s http://localhost:{puerto}/api/health; echo"
    )

    ssh.close()
    for t in (back_tgz, dist_tgz):
        if t: t.unlink(missing_ok=True)
    print(f"\n== Despliegue de '{SLUG}' terminado. ==")


def modo_nueva():
    """Aprovisiona una instancia nueva desde cero: BD, .env, PM2, Apache, SSL, schema limpio + admin."""
    if not DOMINIO or not PUERTO:
        print("ERROR: --nueva requiere --dominio <fqdn> --puerto <numero>"); sys.exit(1)

    reg = load_registry()
    if SLUG in reg:
        print(f"ERROR: '{SLUG}' ya está registrado en instancias.json ({reg[SLUG]}). "
              f"Si quieres redeployar código, usa el modo normal (sin --nueva).")
        sys.exit(1)

    db_name = f"{SLUG}_db"
    db_user = f"{SLUG}_user"
    db_pass = secrets.token_urlsafe(18)
    jwt_secret = secrets.token_hex(32)
    app_dir = f"/var/www/{SLUG}"
    back = f"{app_dir}/backend"
    docroot = f"{app_dir}/frontend/dist"
    pm2_app = f"{SLUG}-api"

    build_frontend()
    back_tgz = tar_backend()
    dist_tgz = tar_dist()

    ssh = connect()
    run = make_run(ssh)

    ya_existe = run(f"[ -d '{back}' ] && echo SI || echo NO", show=False).strip()
    if ya_existe == "SI":
        print(f"ERROR: ya existe {back} en el VPS. Aborto para no pisar una instancia existente.")
        ssh.close(); sys.exit(1)

    print(f"== Creando BD '{db_name}' + usuario '{db_user}' ==")
    run(
        f"mysql -e \"CREATE DATABASE IF NOT EXISTS {db_name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\" && "
        f"mysql -e \"CREATE USER IF NOT EXISTS '{db_user}'@'localhost' IDENTIFIED BY '{db_pass}';\" && "
        f"mysql -e \"GRANT ALL PRIVILEGES ON {db_name}.* TO '{db_user}'@'localhost';\" && "
        f"mysql -e \"FLUSH PRIVILEGES;\" && echo BD_OK"
    )

    print("== Clonando schema (sin datos) desde dismed_db en vivo ==")
    run(
        f"mysqldump --no-data --routines --triggers --single-transaction dismed_db > /tmp/_schema_{SLUG}.sql && "
        f"sed -i -E \"s/DEFINER=\\`[^\\`]+\\`@\\`[^\\`]+\\`/DEFINER=\\`{db_user}\\`@\\`localhost\\`/g\" /tmp/_schema_{SLUG}.sql && "
        f"mysql {db_name} < /tmp/_schema_{SLUG}.sql && rm -f /tmp/_schema_{SLUG}.sql && echo SCHEMA_OK"
    )

    print("== Creando estructura de directorios ==")
    run(
        f"mkdir -p '{back}' '{app_dir}/frontend/dist' '{app_dir}/uploads' '{app_dir}/outputs' '{back}/logs' && "
        f"chown -R www-data:www-data '{app_dir}/frontend' '{app_dir}/uploads' '{app_dir}/outputs' && echo DIRS_OK"
    )

    print("== Reutilizando GEMINI_API_KEY / SMTP de dismed (mismo free tier / relay) ==")
    dismed_env = run("cat /var/www/dismed/backend/.env 2>/dev/null", show=False)
    dismed_cfg = {}
    for line in dismed_env.splitlines():
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); dismed_cfg[k.strip()] = v.strip()
    gemini_key = dismed_cfg.get("GEMINI_API_KEY", "")
    smtp_user = dismed_cfg.get("SMTP_USER", "")
    smtp_pass = dismed_cfg.get("SMTP_PASS", "")
    ingestion_key = secrets.token_hex(24)

    env_content = f"""NODE_ENV=production
PORT={PUERTO}
DB_HOST=localhost
DB_PORT=3306
DB_USER={db_user}
DB_PASSWORD={db_pass}
DB_NAME={db_name}
JWT_SECRET={jwt_secret}
JWT_EXPIRES_IN=8h
UPLOAD_DIR={app_dir}/uploads
OUTPUT_DIR={app_dir}/outputs
BASE_URL=https://{DOMINIO}
FRONTEND_URL=https://{DOMINIO}
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_SKIP_DOWNLOAD=true
EMPRESA_NOMBRE=INNOVACOM
EMPRESA_RFC=RIC1903041Q2
EMPRESA_TELEFONO=55-5161-1095
EMPRESA_EMAIL=cotizaciones@innovacom.mx
EMPRESA_DIRECCION=REFINERIA AZCAPOTZALCO 49, CP 04410, PETROLERA TAXQUENA, CIUDAD DE MEXICO
EMPRESA_WEB=www.innovacom.mx
EMPRESA_REP_LEGAL=RODRIGO CABRERA GONZALEZ
EMPRESA_RAZON_SOCIAL=RODRICABR INNOVACION Y COMERCIO
EMPRESA_REGIMEN_FISCAL=626
EMPRESA_CP=04410
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER={smtp_user}
SMTP_PASS={smtp_pass}
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY={gemini_key}
INGESTION_API_KEY={ingestion_key}
"""
    sftp = ssh.open_sftp()
    with sftp.open(f"{back}/.env", "w") as f:
        f.write(env_content)
    sftp.chmod(f"{back}/.env", 0o600)

    ecosystem = f"""module.exports = {{
  apps: [
    {{
      name: '{pm2_app}',
      script: 'src/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_production: {{
        NODE_ENV: 'production',
        PORT: {PUERTO},
      }},
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }},
  ],
}};
"""
    with sftp.open(f"{back}/ecosystem.config.js", "w") as f:
        f.write(ecosystem)
    sftp.put(str(back_tgz), f"/tmp/_deploy_backend_{SLUG}.tgz")
    sftp.put(str(dist_tgz), f"/tmp/_deploy_dist_{SLUG}.tgz")
    sftp.close()

    print("== Backend: extrayendo + npm install ==")
    run(
        f"tar -xzf /tmp/_deploy_backend_{SLUG}.tgz -C '{back}'; rm -f /tmp/_deploy_backend_{SLUG}.tgz; "
        f"cd '{back}' && PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev 2>&1 | tail -4; echo 'backend OK'"
    )

    print("== Sembrando usuario admin (admin@dismed.mx / Admin1234!) ==")
    run(f"cd '{back}' && node src/modules/auth/seed.js")

    print("== Frontend: extrayendo dist ==")
    run(f"tar -xzf /tmp/_deploy_dist_{SLUG}.tgz -C '{docroot}'; rm -f /tmp/_deploy_dist_{SLUG}.tgz; echo 'dist OK'")

    print("== Apache: creando vhost ==")
    vhost = f"""<VirtualHost *:80>
    ServerName {DOMINIO}
    ServerAlias www.{DOMINIO}

    DocumentRoot {docroot}
    <Directory {docroot}>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyRequests Off
    ProxyPreserveHost On
    ProxyTimeout 300
    ProxyPass        /api      http://127.0.0.1:{PUERTO}/api
    ProxyPassReverse /api      http://127.0.0.1:{PUERTO}/api
    ProxyPass        /outputs  http://127.0.0.1:{PUERTO}/outputs
    ProxyPassReverse /outputs  http://127.0.0.1:{PUERTO}/outputs

    ErrorLog  ${{APACHE_LOG_DIR}}/{SLUG}_error.log
    CustomLog ${{APACHE_LOG_DIR}}/{SLUG}_access.log combined
</VirtualHost>
"""
    sftp = ssh.open_sftp()
    with sftp.open(f"/etc/apache2/sites-available/{SLUG}.conf", "w") as f:
        f.write(vhost)
    sftp.close()
    run(f"a2ensite {SLUG}.conf && apachectl configtest 2>&1 | tail -1 && systemctl reload apache2 && echo VHOST_OK")

    print("== PM2: iniciando proceso ==")
    run(f"cd '{back}' && pm2 start ecosystem.config.js --env production && pm2 save && echo PM2_OK")

    print(f"== Certbot: solicitando SSL para {DOMINIO} (requiere DNS ya apuntando al VPS) ==")
    certbot_out = run(
        f"certbot --apache -d {DOMINIO} -d www.{DOMINIO} --non-interactive --agree-tos "
        f"-m {cfg.get('EMPRESA_EMAIL', 'cotizaciones@innovacom.mx')} 2>&1 | tail -15"
    )
    ssl_ok = "Successfully" in certbot_out or "Congratulations" in certbot_out

    print("== Smoke test ==")
    run(f"echo -n 'health: '; curl -s http://localhost:{PUERTO}/api/health; echo")

    ssh.close()
    for t in (back_tgz, dist_tgz):
        if t: t.unlink(missing_ok=True)

    reg[SLUG] = {
        "dominio": DOMINIO,
        "puerto": int(PUERTO),
        "pm2": pm2_app,
        "app_dir": app_dir,
        "db_name": db_name,
        "db_user": db_user,
        "ssl": "ok" if ssl_ok else "pendiente (correr certbot a mano)",
    }
    save_registry(reg)

    print(f"\n== Instancia '{SLUG}' aprovisionada. ==")
    print(f"   URL: https://{DOMINIO}  (admin@dismed.mx / Admin1234! — cambiar en el primer login)")
    if not ssl_ok:
        print("   AVISO: certbot no confirmó éxito — revisa DNS y corre a mano: "
              f"certbot --apache -d {DOMINIO} -d www.{DOMINIO}")
    print("   Para futuros despliegues de código a esta instancia:")
    print(f"     python deploy_instancia.py {SLUG}")


if __name__ == "__main__":
    if NUEVA:
        modo_nueva()
    else:
        modo_sync()
