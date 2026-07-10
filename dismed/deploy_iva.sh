#!/bin/bash
set -e

# Backend → ruta donde PM2 corre
cp /tmp/solicitudes.controller.js /var/www/dismed/backend/src/modules/solicitudes/solicitudes.controller.js
cp /tmp/migrate_v4.js /var/www/dismed/backend/migrate_v4.js
cp /tmp/solicitudes.controller.js /root/dismed/backend/src/modules/solicitudes/solicitudes.controller.js 2>/dev/null || true

cd /var/www/dismed/backend
node migrate_v4.js
pm2 restart dismed-api
echo BACKEND_OK

# Frontend → fuente, build y publicar
cp /tmp/ComparadorPrecios.jsx /root/dismed/frontend/src/pages/Proveedores/ComparadorPrecios.jsx
cd /root/dismed/frontend
npm run build
cp -r dist/* /var/www/dismed/frontend/dist/
echo FRONTEND_OK
