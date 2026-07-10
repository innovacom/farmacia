#!/bin/bash
set -e

cp /tmp/NuevaSolicitud.jsx   /root/dismed/frontend/src/pages/Solicitudes/NuevaSolicitud.jsx
cp /tmp/DetalleSolicitud.jsx /root/dismed/frontend/src/pages/Solicitudes/DetalleSolicitud.jsx

cd /root/dismed/frontend
npm run build
cp -r dist/* /var/www/dismed/frontend/dist/
echo FRONTEND_OK
