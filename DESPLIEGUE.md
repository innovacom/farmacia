# DESPLIEGUE — Procedimiento ÚNICO y oficial de DISMED

> **Regla de oro:** para desplegar a producción se usa **siempre** `deploy.py`.
> No se usan otros scripts ni se reconstruye el frontend en el VPS.

## TL;DR

En tu PowerShell (en la carpeta del proyecto), **sin `!`**:

```powershell
python deploy.py
```

Eso despliega backend + frontend de forma segura. Termina mostrando `APACHE_OK` y
`health: {"status":"ok",...}`. Después abre el sitio con **Ctrl+F5**.

## Por qué tú lo ejecutas (y no el asistente)

Antes el asistente desplegaba solo por SSH. La política de seguridad del entorno
(harness) ahora **bloquea** que el asistente abra SSH/escriba en producción, así
que **el comando lo lanzas tú**. El asistente prepara y verifica el código; tú
corres `deploy.py` y le pegas la salida para que valide el resultado.

## Qué hace `deploy.py` (y qué NO)

Hace, en este orden:
1. **Construye el frontend localmente** (`npm run build`). Si falla, aborta sin tocar el VPS.
2. **Sincroniza todo el backend** (`src/`, `scripts/`, `migrate_v*.js`, `package.json`) al VPS (respaldando `src` previo en `src.bak.<fecha>`).
3. **`npm install`** en el backend (toma dependencias nuevas si las hay).
4. **Reemplaza la `dist`** servida por Apache (respaldando la previa en `dist.bak.<fecha>`).
5. **Reinicia PM2** y **recarga Apache**. Smoke test a `/api/health`.

**NO** hace (a propósito, para no romper producción):
- ❌ No regenera el `.env` ni reimporta el schema (eso hacían `deploy.sh` / `deploy_ssh.py` — **NO usar**).
- ❌ No reconstruye el frontend en el VPS (eso rompió la UI una vez).
- ❌ No corre migraciones salvo que se lo pidas explícitamente.

Detalles técnicos que evitan los errores que ya vimos:
- Usa **un canal SSH a la vez** (el sshd del VPS limita canales concurrentes → si no, da `Secsh channel open FAILED`).
- **Auto-detecta** la carpeta del backend, el `DocumentRoot` de Apache y el nombre de la app en PM2 (maneja `/var/www/dismed` vs `/root/dismed`).
- Compila local y **sube la `dist` ya hecha** (nunca depende del build del servidor).

## Variantes

```powershell
python deploy.py                          # backend + frontend (lo normal)
python deploy.py --solo-frontend          # solo reconstruye y sube la dist
python deploy.py --solo-backend           # solo backend (no toca la dist)
python deploy.py --migrar migrate_v13.js  # despliega y además corre esa migración en el VPS
```

## Migraciones de base de datos

Las migraciones **no** corren solas. Cuando un cambio incluya una migración nueva:

```powershell
python deploy.py --migrar migrate_vXX.js
```

Las migraciones son idempotentes (`CREATE TABLE/ADD COLUMN IF NOT EXISTS`), así que
volver a correrlas no daña datos.

## Acceso a la base de datos de producción (consultas manuales)

Para conectarte con una herramienta (Workbench/DBeaver) o correr scripts locales
contra la BD del VPS:
1. Abre el túnel: doble clic en **"Tunel BD DISMED"** (Escritorio) — auto-reconecta.
2. Conéctate a `127.0.0.1:3307`, usuario `dismed_user`, BD `dismed_db`
   (el usuario es `@localhost`, por eso **solo** funciona por el túnel, no directo a la IP).

## Requisitos (una vez)

- `pip install paramiko`
- Archivo `.env.server` en la raíz con `SERVER_HOST/USER/PASS` y datos de BD (ya existe).
- Llave SSH `~/.ssh/id_ed25519` (para el túnel de BD).

## Scripts antiguos (NO usar)

- `deploy.sh`, `deploy_ssh.py` → **destructivos** (regeneran `.env`, reimportan schema).
- `deploy_cfdi.py`, `recuperar_frontend.py`, `deploy_orden.py`, `deploy_estatus.py`
  → fueron pasos puntuales; **quedan obsoletos**. Usa siempre `deploy.py`.
