# DESPLIEGUE DE INSTANCIAS — `deploy_instancia.py`

> Un solo código (`dismed/`, este repo) → N instancias (una por farmacia/cliente),
> cada una con su propio dominio, puerto, PM2, Apache y base de datos en el
> mismo VPS. Nunca se duplica código (eso fue un error la primera vez con
> farmacia.innovacom.mx — ver `instancias.json` / memoria del proyecto).

## TL;DR — dar de alta una farmacia NUEVA

En tu PowerShell, en la carpeta del proyecto, **sin `!`**:

```powershell
python deploy_instancia.py nombre_farmacia --nueva --dominio nombre_farmacia.innovacom.mx --puerto 3003
```

Esto, en un solo paso:
1. Crea la base de datos y el usuario MySQL de la instancia.
2. Clona el schema (sin datos) desde `dismed_db` **en vivo** — o sea, siempre
   incluye todas las migraciones ya aplicadas en producción, no hace falta
   jugar migrate_v2..vN a mano.
3. Crea `/var/www/<slug>/` (backend, frontend, uploads, outputs, logs).
4. Escribe el `.env` de la instancia (JWT_SECRET y password de BD nuevos y
   aleatorios; reutiliza el mismo `GEMINI_API_KEY` y SMTP que dismed).
5. Sube el backend + la dist del frontend (mismo build, no hay diferencias de
   código entre instancias).
6. Siembra el usuario admin (`admin@dismed.mx` / `Admin1234!`).
7. Crea el vhost de Apache y pide el certificado SSL con `certbot`
   (**requiere que el DNS del dominio ya apunte al VPS antes de correr esto**).
8. Arranca el proceso en PM2 y hace un smoke test a `/api/health`.
9. Registra la instancia en `instancias.json` (sin secretos, se puede
   commitear).

Al final imprime la URL y un aviso si el certificado SSL no se pudo emitir
(normalmente porque el DNS aún no propaga — en ese caso corre el `certbot`
que te sugiere el propio script, a mano, cuando el DNS ya esté listo).

Puerto: usa el siguiente libre (dismed=3001, farmacia=3002 → la próxima sería
3003, etc.). Revisa `instancias.json` para ver los puertos ya tomados.

## TL;DR — desplegar código nuevo a una instancia YA existente

Igual que `deploy.py`, pero apuntando a esa instancia. **No toca `.env` ni
datos**:

```powershell
python deploy_instancia.py farmacia                     # backend + frontend
python deploy_instancia.py farmacia --solo-frontend      # solo la dist
python deploy_instancia.py farmacia --solo-backend       # solo backend
python deploy_instancia.py farmacia --migrar migrate_v31.js   # + corre esa migración ahí
python deploy_instancia.py farmacia --migrar-todas       # corre migrate_v2..v30 en orden
                                                          # (idempotentes, no rompen nada
                                                          #  si ya estaban aplicadas —
                                                          #  úsalo para poner una instancia
                                                          #  al corriente después de varias
                                                          #  migraciones nuevas)
```

Ejemplo real ya corrido (2026-07-16): tras agregar `precio_costo` /
`margen_ganancia` / el CHECK de precios en el catálogo (migrate_v30) y
desplegarlo a producción (dismed), se puso a farmacia.innovacom.mx al día con:

```powershell
python deploy_instancia.py farmacia --migrar-todas
```

## Requisitos

- `.env.server` en la raíz del repo (las mismas credenciales SSH que usa
  `deploy.py`: `SERVER_HOST`, `SERVER_USER`, `SERVER_PASS` — root en el VPS
  72.249.60.175). No hace falta un `.env.server` por instancia.
- `pip install paramiko`.
- Para `--nueva`: el dominio debe tener su registro DNS (A) apuntando ya al
  VPS antes de correr el comando, si no el paso de `certbot` fallará (no es
  grave: el vhost HTTP queda funcionando igual, solo falta correr certbot
  después a mano).

## Dónde queda registrada cada instancia

`instancias.json` en la raíz (sin secretos, se puede ver/commitear):

```json
{
  "farmacia": {
    "dominio": "farmacia.innovacom.mx",
    "puerto": 3002,
    "pm2": "farmacia-api",
    "app_dir": "/var/www/farmacia",
    "db_name": "farmacia_db",
    "db_user": "farmacia_user"
  }
}
```

Los secretos reales (`DB_PASSWORD`, `JWT_SECRET`, etc.) solo viven en el
`.env` de cada instancia **en el VPS**, nunca en este repo.

## Qué NO hace (a propósito)

- No borra ni resetea datos de una instancia existente (modo sync).
- No reconstruye el frontend en el VPS — siempre compila local y sube la
  `dist` ya hecha.
- No usa `deploy.sh` / `deploy_ssh.py` — esos regeneran `.env` y reimportan
  schema, son destructivos. `deploy_instancia.py` sigue el mismo patrón
  seguro que `deploy.py`.
