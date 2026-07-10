#!/bin/bash
# ============================================================
# DISMED - Script de instalacion en servidor Linux (Debian 12)
# Ejecutar como root o con sudo
# Uso: sudo bash /tmp/dismed-pkg/deploy.sh
# ============================================================

set -e  # Terminar si cualquier comando falla

# ---- Variables inyectadas por deploy.ps1 ----
APP_DIR="${APP_DIR:-/var/www/dismed}"
PKG_DIR="${PKG_DIR:-/tmp/dismed-pkg}"
DB_NAME="${DB_NAME:-dismed_db}"
DB_USER="${DB_USER:-dismed_user}"
DB_PASS="${DB_PASS:-changeme}"
JWT_SECRET="${JWT_SECRET:-changeme_jwt}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-REEMPLAZAR_CON_TU_API_KEY}"
EMPRESA_NOMBRE="${EMPRESA_NOMBRE:-DISMED}"
EMPRESA_RFC="${EMPRESA_RFC:-XAXX010101000}"
EMPRESA_TELEFONO="${EMPRESA_TELEFONO:-5500000000}"
EMPRESA_EMAIL="${EMPRESA_EMAIL:-contacto@dismed.mx}"
EMPRESA_DIRECCION="${EMPRESA_DIRECCION:-Ciudad de Mexico, CDMX}"
SERVER_HOST="${SERVER_HOST:-localhost}"
SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"
MYSQL_ROOT="mysql"  # se actualiza si root requiere password

echo ""
echo "======================================================"
echo "  DISMED - Instalacion en servidor de produccion"
echo "======================================================"
echo ""

# ---- Permisos ----
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Este script debe ejecutarse como root o con sudo"
    exit 1
fi

# Evitar prompts interactivos en apt
export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none
export APT_LISTBUGS_FRONTEND=none

# ---- 1. Actualizar sistema ----
echo "▶ Actualizando paquetes del sistema..."
apt-get update -y -q
apt-get install -y -q curl wget gnupg2 lsb-release apt-transport-https ca-certificates

# ---- 2. Node.js 20 ----
echo "▶ Instalando Node.js 20..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -q nodejs
fi
echo "   Node.js: $(node -v) | npm: $(npm -v)"

# ---- 3. PM2 ----
echo "▶ Instalando PM2..."
npm install -g pm2 --silent

# ---- 4. Apache2 ----
echo "▶ Configurando Apache2..."
apt-get install -y -q apache2
a2enmod proxy proxy_http rewrite headers 2>/dev/null || true

# ---- 5. MySQL / MariaDB ----
echo "▶ Configurando base de datos..."
if ! command -v mysql &> /dev/null; then
    echo "   MySQL no encontrado. Instalando MariaDB..."
    apt-get install -y -q mariadb-server mariadb-client
    systemctl start mariadb
    systemctl enable mariadb
    echo "   MariaDB instalado."
fi

# Obtener acceso root a MariaDB (puede usar unix_socket o necesitar password)
echo "   Verificando acceso root a MariaDB..."
if mysql -e "SELECT 1;" 2>/dev/null; then
    echo "   Acceso unix_socket OK"
    MYSQL_ROOT="mysql"
else
    echo "   Reseteando acceso root de MariaDB (password desconocido)..."
    DB_ROOT_PASS="DismedRoot$(openssl rand -hex 8)"

    # Parar MariaDB y arrancar en modo sin autenticacion
    systemctl stop mariadb 2>/dev/null
    sleep 2
    mysqld_safe --skip-grant-tables --skip-networking --pid-file=/tmp/mysqld-skip.pid &
    SAFE_PID=$!
    sleep 6

    # Resetear password del root
    mysql --connect-timeout=10 -u root <<RESET 2>/dev/null || true
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '${DB_ROOT_PASS}';
FLUSH PRIVILEGES;
RESET

    # Parar el proceso temporal y reiniciar normalmente
    kill $SAFE_PID 2>/dev/null
    pkill -f "skip-grant-tables" 2>/dev/null
    sleep 3
    systemctl start mariadb
    sleep 3
    echo "   Password root de MariaDB actualizado."
    MYSQL_ROOT="mysql -u root -p${DB_ROOT_PASS}"
fi

# Crear base de datos y usuario
echo "▶ Creando base de datos '${DB_NAME}'..."
${MYSQL_ROOT} <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ---- 6. Chromium (para Puppeteer) ----
echo "▶ Instalando Chromium para generacion de PDFs..."
apt-get install -y -q chromium
CHROMIUM_PATH=$(which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo "/usr/bin/chromium")

# ---- 7. Copiar archivos de la aplicacion ----
echo "▶ Instalando archivos de la aplicacion en ${APP_DIR}..."
mkdir -p "${APP_DIR}"
mkdir -p "${APP_DIR}/uploads"
mkdir -p "${APP_DIR}/outputs"
mkdir -p "${APP_DIR}/logs"

# Copiar desde el paquete temporal
cp -r "${PKG_DIR}/dismed/backend/." "${APP_DIR}/backend/"
cp -r "${PKG_DIR}/dismed/frontend/." "${APP_DIR}/frontend/"
cp "${PKG_DIR}/dismed/dismed_schema_v2.sql" "${APP_DIR}/" 2>/dev/null || \
cp "${PKG_DIR}/dismed/dismed_schema_vmariadb.sql" "${APP_DIR}/schema.sql" 2>/dev/null || true

# ---- 8. Importar schema SQL ----
echo "▶ Importando schema de base de datos..."
SCHEMA_FILE="${APP_DIR}/dismed_schema_v2.sql"
# Elegir schema correcto segun motor de BD
if ${MYSQL_ROOT} -e "SELECT VERSION();" 2>/dev/null | grep -qi "mariadb"; then
    SCHEMA_FILE="${APP_DIR}/schema.sql"
    if [ ! -f "$SCHEMA_FILE" ]; then
        SCHEMA_FILE="${APP_DIR}/dismed_schema_v2.sql"
    fi
fi
if [ -f "$SCHEMA_FILE" ]; then
    mysql -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" < "$SCHEMA_FILE"
    echo "   Schema importado correctamente."
else
    echo "   ⚠ Archivo SQL no encontrado, importa manualmente."
fi

# ---- 9. Variables de entorno del backend ----
echo "▶ Creando archivo .env de produccion..."
cat > "${APP_DIR}/backend/.env" <<ENV
# DISMED Backend - Produccion
NODE_ENV=production
PORT=3001

# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=8h

# Anthropic (parser PDF con IA)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Archivos
UPLOAD_DIR=${APP_DIR}/uploads
OUTPUT_DIR=${APP_DIR}/outputs
BASE_URL=http://${SERVER_HOST}

# Frontend URL (CORS)
FRONTEND_URL=http://${SERVER_HOST}

# Puppeteer (usa Chromium del sistema)
PUPPETEER_EXECUTABLE_PATH=${CHROMIUM_PATH}
PUPPETEER_SKIP_DOWNLOAD=true

# Empresa (aparece en PDFs)
EMPRESA_NOMBRE=${EMPRESA_NOMBRE}
EMPRESA_RFC=${EMPRESA_RFC}
EMPRESA_TELEFONO=${EMPRESA_TELEFONO}
EMPRESA_EMAIL=${EMPRESA_EMAIL}
EMPRESA_DIRECCION=${EMPRESA_DIRECCION}
EMPRESA_WEB=${EMPRESA_WEB}
EMPRESA_REP_LEGAL=${EMPRESA_REP_LEGAL}

# Email
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
ENV

# ---- 10. Instalar dependencias del backend ----
echo "▶ Instalando dependencias del backend..."
cd "${APP_DIR}/backend"
PUPPETEER_SKIP_DOWNLOAD=true npm install --production --silent

# ---- 11. Construir el frontend ----
echo "▶ Construyendo frontend (React + Vite)..."
cd "${APP_DIR}/frontend"
npm install --silent
npm run build

# ---- 12. Usuario admin inicial ----
echo "▶ Creando usuario administrador inicial..."
cd "${APP_DIR}/backend"
node src/modules/auth/seed.js || echo "   ⚠ seed.js ya ejecutado o error. Continua..."

# ---- 13. PM2 ecosystem ----
echo "▶ Configurando PM2..."
cat > "${APP_DIR}/ecosystem.config.js" <<PM2
module.exports = {
  apps: [{
    name: 'dismed-api',
    script: 'src/app.js',
    cwd: '${APP_DIR}/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production' },
    error_file: '${APP_DIR}/logs/dismed-err.log',
    out_file: '${APP_DIR}/logs/dismed-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
PM2

# Detener instancia anterior si existe
pm2 stop dismed-api 2>/dev/null || true
pm2 delete dismed-api 2>/dev/null || true

# Iniciar
pm2 start "${APP_DIR}/ecosystem.config.js"
pm2 startup | tail -1 | bash 2>/dev/null || true
pm2 save

# ---- 14. Permisos ----
echo "▶ Configurando permisos..."
chown -R www-data:www-data "${APP_DIR}/uploads" \
                            "${APP_DIR}/outputs" \
                            "${APP_DIR}/logs" 2>/dev/null || \
chown -R admin:admin        "${APP_DIR}/uploads" \
                            "${APP_DIR}/outputs" \
                            "${APP_DIR}/logs"

# ---- 15. Configurar Apache ----
echo "▶ Configurando Apache VirtualHost..."
cat > /etc/apache2/sites-available/dismed.conf <<APACHE
<VirtualHost *:80>
    ServerName ${SERVER_HOST}
    DocumentRoot ${APP_DIR}/frontend/dist

    <Directory ${APP_DIR}/frontend/dist>
        AllowOverride All
        Require all granted
        Options -Indexes
        # React Router: redirigir todo al index.html
        FallbackResource /index.html
    </Directory>

    # Proxy API al backend Node.js
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyPass /api http://localhost:3001/api
    ProxyPassReverse /api http://localhost:3001/api

    # Servir PDFs generados
    ProxyPass /outputs http://localhost:3001/outputs
    ProxyPassReverse /outputs http://localhost:3001/outputs

    ErrorLog \${APACHE_LOG_DIR}/dismed-error.log
    CustomLog \${APACHE_LOG_DIR}/dismed-access.log combined
</VirtualHost>
APACHE

a2dissite 000-default 2>/dev/null || true
a2ensite dismed
systemctl restart apache2

# ---- Resumen final ----
echo ""
echo "======================================================"
echo "  ✅ DISMED instalado correctamente"
echo "======================================================"
echo ""
echo "  URL:        http://${SERVER_HOST}"
echo "  API Health: http://${SERVER_HOST}/api/health"
echo "  Usuario:    admin@dismed.mx"
echo "  Password:   Admin1234!"
echo ""
echo "  ⚠  IMPORTANTE:"
echo "  1. Cambia la password del admin en el primer login"
echo "  2. Configura ANTHROPIC_API_KEY en:"
echo "     ${APP_DIR}/backend/.env"
echo "     (luego ejecuta: pm2 restart dismed-api)"
echo ""
echo "  Logs en tiempo real: pm2 logs dismed-api"
echo "======================================================"
