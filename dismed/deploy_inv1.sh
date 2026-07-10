#!/bin/bash
set -e

# ── Backend (ruta donde corre PM2) ────────────────────────────────────────────
mkdir -p /var/www/dismed/backend/src/modules/inventario
tar -xf /tmp/inv1_backend.tar -C /var/www/dismed/backend
# Copia de referencia en /root (no crítica)
mkdir -p /root/dismed/backend/src/modules/inventario 2>/dev/null || true
tar -xf /tmp/inv1_backend.tar -C /root/dismed/backend 2>/dev/null || true

cd /var/www/dismed/backend
echo "== Migración v5 =="
node migrate_v5.js
echo "== Seed catálogos de apoyo =="
node seed_inventario.js
pm2 restart dismed-api
echo BACKEND_OK

# ── Frontend ──────────────────────────────────────────────────────────────────
mkdir -p /root/dismed/frontend/src/pages/Inventario
tar -xf /tmp/inv1_frontend.tar -C /root/dismed/frontend
cd /root/dismed/frontend
npm run build
cp -r dist/* /var/www/dismed/frontend/dist/
echo FRONTEND_OK
