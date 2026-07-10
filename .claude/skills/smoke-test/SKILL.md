---
name: smoke-test
description: Verificación rápida post-deploy de DISMED en producción (PM2 vivo, endpoints clave responden, esquema/conteos sanos) vía SSH al VPS. Invocar con /smoke-test.
disable-model-invocation: true
---

# /smoke-test — Verificación post-deploy de DISMED

Corre los chequeos de humo que normalmente se hacen a mano tras un `python deploy.py`: que el backend esté vivo bajo PM2, que los endpoints clave respondan y que la BD esté en pie. Reemplaza los `curl`/`pm2`/`DESCRIBE` sueltos repetidos.

## Objetivo
Producción: `https://sistema.innovacom.mx` · VPS `claude@72.249.60.175` (SSH con `~/.ssh/id_ed25519`, `BatchMode=yes`). El backend corre en `127.0.0.1:3001` bajo PM2 como `dismed-api`; Apache hace proxy de `/api` y `/outputs`.

## Pasos
1. **PM2 vivo.** Confirma que `dismed-api` está `online` y sin reinicios recientes:
   ```bash
   ssh -o BatchMode=yes -i ~/.ssh/id_ed25519 claude@72.249.60.175 "sudo pm2 jlist" \
     # extrae name=dismed-api → status, restart_time, uptime
   ```
   Si está `errored` o con reinicios subiendo, trae las últimas líneas: `sudo pm2 logs dismed-api --err --lines 12 --nostream`.
2. **Endpoints clave** (a través de Apache, HTTPS). Espera estos códigos:
   - `GET /api/health` → **200**
   - `POST /api/auth/login` con body `{}` → **400/401** (responde y valida, no 502)
   - Una ruta protegida sin token (p. ej. `/api/ventas/pedidos`) → **401** (montada, con auth)
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://sistema.innovacom.mx/api/health
   ```
   Un **502/504** o timeout = backend caído o proxy mal → marca FALLO y revisa PM2/Apache.
3. **BD en pie** (vía MCP `dismed-mysql` si está disponible, o `sudo mariadb dismed_db -e ...` por SSH). Conteos sanos, no exhaustivos:
   - `SELECT COUNT(*) FROM cotizaciones_cliente;` y `solicitudes` → > 0 y coherentes.
   - Opcional: una vista clave (`v_existencias` / `v_comparador_precios`) devuelve filas sin error.
4. **Frontend** servido: `GET /` → 200 y devuelve el `index.html` del build.

## Salida
Tabla corta: cada chequeo con ✅/❌, el valor observado y el esperado. Cierra con veredicto: **DEPLOY SANO** o **REVISAR: <qué falló>**. No hagas cambios; esto solo observa.

## Reglas
- **Solo lectura.** Nada de `ALTER`/`UPDATE`/`pm2 restart`/`deploy` aquí. Si algo está mal, repórtalo y deja que el usuario decida.
- No imprimas secretos (.env, llaves). Si un comando los mostraría, recórtalos.
- Si el VPS no responde por SSH, dilo y detente; no asumas que está sano.
