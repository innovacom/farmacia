---
name: descarga-sat
description: Dispara a demanda la descarga masiva de CFDI del SAT (emitidos/recibidos) para un mes o rango, la monitorea hasta terminar y reconcilia estatus. Se ejecuta vía SSH contra el VPS. Invocar con /descarga-sat.
disable-model-invocation: true
---

# /descarga-sat — Descarga masiva de CFDI del SAT a demanda

Versión "a demanda" del cron mensual (`sat.cron.js`, día 3). Reutiliza el servicio
que ya existe; NO cambia código de producción. **Solo invocable por el usuario**
(usa la e.firma y la BD de producción). Toda la ejecución es **vía SSH al VPS**.

## Argumentos
- `$ARGUMENTS` = mes `YYYY-MM` (p.ej. `2026-05`) o rango `YYYY-MM-DD YYYY-MM-DD`.
- Tipo opcional: `emitido`, `recibido` o ambos (default: **ambos**).
- Sin argumentos: preguntar el periodo antes de continuar.

## Datos del entorno (fijos)
- **SSH:** `claude@72.249.60.175`, llave `~/.ssh/id_ed25519`, `sudo` NOPASSWD.
- **Backend (PM2):** `/var/www/dismed/backend` — proceso `dismed-api`.
- **Script CLI:** `scripts/descarga_sat.js` — valida la e.firma con **`ValidaSat`**,
  luego `solicitarDescarga` + `procesarConEspera` por tipo. Acepta:
  `<YYYY-MM | YYYY-MM-DD YYYY-MM-DD> [emitido|recibido]` (sin tipo = ambos).
- **Reanudar pendientes:** `src/modules/cfdi/sat.descarga.service.js` → `procesarPendientes()`.
- El SAT es asíncrono: una solicitud tarda de segundos a horas; el flujo es
  reanudable vía la bitácora `cfdi_descargas`.

## Flujo

1. **Resolver argumentos.** De `$ARGUMENTS` tomar el periodo (mes `YYYY-MM` o rango
   `YYYY-MM-DD YYYY-MM-DD`) y, si lo hay, el tipo (`emitido`/`recibido`). Pasarlos
   tal cual al script.

2. **Ejecutar el script vía SSH** (valida la e.firma con `ValidaSat` y, si es válida,
   solicita + espera por cada tipo). Ejemplo para el mes 2026-05, ambos tipos:
   ```bash
   ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no claude@72.249.60.175 \
     "cd /var/www/dismed/backend && sudo node scripts/descarga_sat.js 2026-05"
   ```
   - Un solo tipo: `... descarga_sat.js 2026-05 emitido`
   - Rango de fechas: `... descarga_sat.js 2026-05-01 2026-05-15`
   - Si el script sale con código ≠ 0 (e.firma inválida/vencida), **detener** y reportar.

3. **Si el SAT aún no termina** (algún tipo no llegó a `descargada` al agotar la
   espera del script), reanudar más tarde con `procesarPendientes`:
   ```bash
   ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no claude@72.249.60.175 \
     'cd /var/www/dismed/backend && sudo node -e "require(\"./src/modules/cfdi/sat.descarga.service\").procesarPendientes().then(r=>{console.log(JSON.stringify(r));process.exit(0)})"'
   ```
   (La reconciliación de estatus vigente/cancelado se encola sola al terminar el XML.)

4. **Reportar** la línea `RESUMEN:` del script: por tipo, el estado final y los
   conteos (`num_cfdis`, `num_importados`). Indicar que el detalle queda consultable
   en la página `/cfdi`.

## Notas
- Idempotente por UUID: re-descargar un mes no duplica comprobantes.
- NUNCA tocar `.env` ni la e.firma (`*.cer`/`*.key`) — viven solo en el VPS.
- `ValidaSat` y el servicio deben estar desplegados en el VPS (ver `/deploy`).
