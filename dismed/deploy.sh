#!/bin/bash
# ================================================================
#  DISMED — Script de despliegue inicial en Debian 12 + Apache
#  Ejecutar como root o con sudo: bash deploy.sh
#
#  Antes de ejecutar:
#    1. Sube toda la carpeta "dismed/" al VPS (scp, FTP o git)
#    2. Edita las variables al inicio de este script
# ================================================================

set -e   # salir al primer error

# ────────────────────────────────────────────────────────────────
#  CONFIGURA ESTAS VARIABLES
# ────────────────────────────────────────────────────────────────
DOMAIN="sistema.innovacom.mx"
DISMED_SRC="/root/dismed"                         # donde subiste el proyecto
WEB_ROOT="/var/www/dismed"                        # destino en el servidor
DB_USER="dismed_user"
DB_PASS="TuPasswordSeguro123!"                    # cambia esto
DB_NAME="dismed_db"
NODE_VERSION="20"                                 # LTS actual
# ────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   DISMED — Instalación en Debian 12       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Dependencias del sistema ──────────────────────────────────
echo "▶ [1/9] Instalando dependencias del sistema..."
apt-get update -q
apt-get install -y -q \
    curl wget git apache2 \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    ca-certificates gnupg

# ── 2. Node.js ───────────────────────────────────────────────────
echo "▶ [2/9] Instalando Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y -q nodejs
fi
echo "   Node: $(node -v)  |  npm: $(npm -v)"

# ── 3. PM2 ───────────────────────────────────────────────────────
echo "▶ [3/9] Instalando PM2..."
npm install -g pm2 --quiet

# ── 4. Módulos Apache ────────────────────────────────────────────
echo "▶ [4/9] Activando módulos Apache (proxy)..."
a2enmod proxy proxy_http rewrite headers
systemctl enable apache2

# ── 5. Usuario MariaDB ───────────────────────────────────────────
echo "▶ [5/9] Creando usuario MariaDB '${DB_USER}'..."
mysql -u root <<SQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "   ✅ Usuario creado (la BD ya debe existir desde tu import previo)"

# ── 6. Estructura de directorios ─────────────────────────────────
echo "▶ [6/9] Creando directorios en ${WEB_ROOT}..."
mkdir -p ${WEB_ROOT}/frontend
mkdir -p ${WEB_ROOT}/uploads
mkdir -p ${WEB_ROOT}/outputs
mkdir -p ${WEB_ROOT}/backend/logs

# ── 7. Backend ───────────────────────────────────────────────────
echo "▶ [7/9] Instalando backend..."
cp -r ${DISMED_SRC}/backend/* ${WEB_ROOT}/backend/
cd ${WEB_ROOT}/backend

# Copiar .env de producción si existe, si no copiar example
if [ -f ".env.production" ]; then
    cp .env.production .env
    echo "   ⚠️  Revisa ${WEB_ROOT}/backend/.env antes de iniciar"
elif [ ! -f ".env" ]; then
    echo "   ❌ No se encontró .env — créalo manualmente en ${WEB_ROOT}/backend/.env"
fi

npm install --omit=dev --quiet
echo "   ✅ Backend instalado"

# ── 8. Frontend (build) ──────────────────────────────────────────
echo "▶ [8/9] Construyendo frontend..."
cd ${DISMED_SRC}/frontend
npm install --quiet
npm run build
cp -r dist/* ${WEB_ROOT}/frontend/
echo "   ✅ Frontend compilado en ${WEB_ROOT}/frontend"

# ── 9. Apache VirtualHost ────────────────────────────────────────
echo "▶ [9/9] Configurando Apache..."
cat > /etc/apache2/sites-available/dismed.conf << APACHECONF
<VirtualHost *:80>
    ServerName ${DOMAIN}

    DocumentRoot ${WEB_ROOT}/frontend

    <Directory ${WEB_ROOT}/frontend>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        FallbackResource /index.html
    </Directory>

    ProxyPreserveHost On
    ProxyPass        /api      http://127.0.0.1:3001/api
    ProxyPassReverse /api      http://127.0.0.1:3001/api
    ProxyPass        /outputs  http://127.0.0.1:3001/outputs
    ProxyPassReverse /outputs  http://127.0.0.1:3001/outputs

    ErrorLog  \${APACHE_LOG_DIR}/dismed_error.log
    CustomLog \${APACHE_LOG_DIR}/dismed_access.log combined
</VirtualHost>
APACHECONF

a2dissite 000-default.conf 2>/dev/null || true
a2ensite dismed.conf
systemctl reload apache2

# ── Crear admin y arrancar PM2 ───────────────────────────────────
echo ""
echo "▶ Creando usuario admin del sistema..."
cd ${WEB_ROOT}/backend
node src/modules/auth/seed.js

echo ""
echo "▶ Iniciando DISMED con PM2..."
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  DISMED instalado correctamente                       ║"
echo "║                                                           ║"
echo "║  URL:    http://${DOMAIN}                                 ║"
echo "║  Login:  admin@dismed.mx  /  Admin1234!                   ║"
echo "║                                                           ║"
echo "║  ⚠️  IMPORTANTE:                                          ║"
echo "║  1. Edita ${WEB_ROOT}/backend/.env con tus datos reales   ║"
echo "║  2. Cambia la contraseña del admin en el primer login     ║"
echo "║  3. SSL: sudo certbot --apache -d ${DOMAIN}               ║"
echo "╚══════════════════════════════════════════════════════════╝"
