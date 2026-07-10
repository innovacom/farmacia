---
name: deploy
description: Despliega DISMED al VPS (backend a /var/www, migración, PM2, build y publicación del frontend dist) en un solo flujo reproducible. Invocar con /deploy.
disable-model-invocation: true
---

# /deploy — Despliegue de DISMED al VPS

Empaqueta toda la coreografía SSH que antes se hacía a mano. **Solo se invoca por el usuario** (acción con efectos en producción).

## Datos del entorno (fijos)

- **SSH:** `claude@72.249.60.175`, llave `~/.ssh/id_ed25519`, `sudo` NOPASSWD.
- **Backend (PM2):** `/var/www/dismed/backend` — proceso PM2 `dismed-api`.
- **Frontend publicado:** `/var/www/dismed/frontend/dist` (servido por Apache).
- **Fuente local:** `dismed/backend` y `dismed/frontend` (cwd del proyecto).
- **BD:** `dismed_db` solo escucha en localhost del VPS.

> `/var/www` es de root: NO se puede `scp` directo. Patrón obligatorio: `scp` a `/tmp` → `sudo mv` al destino.
> Tras `graphify update` el cwd de PowerShell cambia a la raíz del proyecto: usa siempre rutas desde la raíz (`dismed/backend/...`).

## Flujo

1. **Determinar qué cambió.** Pregunta al usuario (o deduce del trabajo de la sesión) qué archivos de backend y/o frontend se tocaron. No subas `node_modules`, `.env` (ver paso 4) ni `uploads/`/`outputs/`.

2. **Backend — copiar archivos cambiados.** Para cada archivo:
   ```bash
   scp -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no <ruta-local> claude@72.249.60.175:/tmp/<archivo>
   ```
   Luego en una sola sesión SSH: `sudo mv /tmp/<archivo> /var/www/dismed/backend/<ruta-destino>` y `sudo chown -R www-data:www-data` del directorio tocado.

3. **Verificar carga antes de reiniciar:**
   ```bash
   cd /var/www/dismed/backend && sudo node -e "require('./src/app')" 2>&1 | head   # o require del módulo cambiado
   ```
   Si hay error de sintaxis/require, NO reinicies; corrige y reintenta.

4. **`.env`:** NUNCA sobrescribas el `.env` del VPS (tiene credenciales de localhost distintas a las locales). Solo agrega claves nuevas con `sudo sed`/`tee` si no existen.

5. **Migración (si aplica):** si se agregó un `migrate_vN.js`, córrelo en el VPS:
   ```bash
   cd /var/www/dismed/backend && sudo node migrate_vN.js
   ```
   Las migraciones del repo son idempotentes (`ADD COLUMN IF NOT EXISTS`).

6. **Reiniciar backend:** `pm2 restart dismed-api` (o `sudo pm2 restart all`). `dotenv` re-lee `.env` al arrancar.

7. **Frontend (si cambió):** compila local `npm run build` en `dismed/frontend`, empaqueta y publica:
   ```bash
   tar -czf /tmp/dismed_dist.tgz -C dist .
   scp -i ~/.ssh/id_ed25519 /tmp/dismed_dist.tgz claude@72.249.60.175:/tmp/
   # en VPS:
   D=/var/www/dismed/frontend/dist
   sudo cp -r $D ${D}.bak_$(date +%s)        # respaldo
   sudo rm -rf ${D:?}/* && sudo tar -xzf /tmp/dismed_dist.tgz -C $D
   sudo chown -R www-data:www-data $D
   ```

8. **Smoke test:** reintentar hasta 5 veces con `sleep 1` (PM2 tarda en bindear el puerto):
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/clientes   # espera 401 (auth), NO 000 ni 502
   ```
   Reporta el resultado al usuario (código HTTP + estado PM2).

## Notas

- El SSH del VPS imprime un banner largo; fíltralo con `grep -v` para leer la salida real.
- Si el `scp` "no hace nada", revisa que no esté redirigido a `Out-Null` y que las rutas sean desde la raíz del proyecto.
- El backend de producción ha llegado a estar más viejo que el repo local: al copiar archivos completos confirma que no pisas código más nuevo del VPS (compara líneas/markers antes de sobrescribir `app.js`).
