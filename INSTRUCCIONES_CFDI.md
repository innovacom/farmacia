# Cómo ejecutar el despliegue del módulo CFDI (paso a paso)

Todo el código está construido y probado en vivo contra el SAT. Falta **ejecutar
el despliegue en producción**. Esto se hace **desde ESTA PC** (no en el VPS): el
script se conecta solo al VPS por SSH.

---

## OPCIÓN RECOMENDADA — Despliegue completo (un comando, desde esta PC)

Hace TODO: sube código + e.firma + JSON legacy, instala dependencias, corre la
migración `migrate_v13.js`, carga el histórico `legacy_cfdi_load.js`, reconstruye
el frontend y reinicia PM2. **No necesita el túnel.**

1. Abre **PowerShell** (tecla Windows → escribe "PowerShell" → Enter).
2. Pega esto y Enter:
   ```powershell
   cd "C:\innovacom\OneDrive - RODRICABR INNOVACION Y COMERCIO SAS DE CV\aplicaciones\claude\sistema cotizaciones"
   python deploy_cfdi.py
   ```
3. Verás el progreso (subida, migración, carga, build, reinicio) y un smoke test
   final con el conteo de `cfdi_repositorio`. Si algo falla, copia el output.

> También puedes correrlo desde el chat de Claude escribiendo:
> `! python "deploy_cfdi.py"`  (el prefijo `!` lo ejecuta tu sesión y yo veo el resultado).

---

## OPCIÓN B — Solo la base de datos (migración + histórico), vía túnel

Úsala si solo quieres crear las tablas y cargar el histórico sin tocar el resto.

1. Abre el túnel: **doble clic en el acceso directo "Tunel BD DISMED"** del Escritorio
   (se reconecta solo si se cae). Deja esa ventana abierta.
2. En **otra** ventana de PowerShell:
   ```powershell
   cd "C:\innovacom\OneDrive - RODRICABR INNOVACION Y COMERCIO SAS DE CV\aplicaciones\claude\sistema cotizaciones\dismed\backend"
   $env:DB_HOST='127.0.0.1'; $env:DB_PORT='3307'
   $env:DB_USER='dismed_user'; $env:DB_PASSWORD='Y8XSSmUjLrsiben0bJWJ'; $env:DB_NAME='dismed_db'
   node migrate_v13.js
   node scripts/legacy_cfdi_load.js
   ```
   (El código del backend/cron/página aún tendría que desplegarse con la Opción A.)

---

## El túnel SSH a la BD (para que no se caiga)

- Acceso directo en el Escritorio: **"Tunel BD DISMED"** → levanta `tunel-bd.ps1`.
- `tunel-bd.ps1` **reconecta automáticamente** si la sesión se cae (keepalive cada
  15 s + reintento). Mapea `127.0.0.1:3307 → VPS:3306`. Es el que usa el MCP
  `dismed-mysql` para consultar la BD desde aquí.
- Para cerrarlo: Ctrl+C en su ventana.

---

## Permitir que Claude ejecute el deploy (regla de permiso)

Por seguridad, el clasificador de Claude bloquea que el agente ejecute SSH/deploy a
producción aunque lo apruebes en el chat. Para autorizarlo de forma permanente, **tú**
debes añadir la regla (yo no puedo auto-otorgármela):

1. Abre el archivo:
   `C:\innovacom\OneDrive - RODRICABR INNOVACION Y COMERCIO SAS DE CV\aplicaciones\claude\sistema cotizaciones\.claude\settings.local.json`
2. Dentro de `"permissions" → "allow"` (es una lista `[...]`), agrega estas líneas
   **antes del corchete de cierre `]`** (pon una coma al final del elemento anterior):
   ```json
   "PowerShell(python deploy_cfdi.py*)",
   "Bash(python deploy_cfdi.py*)",
   "Bash(node migrate_v13.js)",
   "Bash(node scripts/legacy_cfdi_load.js)"
   ```
3. Guarda. (Opcional, reinicia Claude Code para que recargue settings.)

> Nota honesta: en el modo automático actual el clasificador ha ignorado incluso
> reglas tan amplias como `Bash(ssh *)` que ya tienes. Si tras agregar la regla
> sigue bloqueando, la vía 100% confiable es ejecutar tú el comando (Opción A/B);
> el agente verá el resultado y te ayuda a verificar/ajustar.

---

## Después del despliegue (verificación)

- Web: entra a **`/cfdi`** ("Facturas CFDI" en el menú).
- Botón **"Descargar del SAT"** → elige mes anterior → Solicitar. El SAT procesa en
  asíncrono; usa **"Actualizar"** en la bitácora hasta que el estado sea `descargada`.
- El cron automático corre el **día 3 de cada mes (04:00 CDMX)** para el mes anterior
  (emitidos y recibidos), siempre que `SAT_CRON_ENABLED=true` esté en el `.env` del VPS
  (el deploy lo agrega solo).
- Detalle técnico completo en `DESPLIEGUE_CFDI_SAT.md`.
