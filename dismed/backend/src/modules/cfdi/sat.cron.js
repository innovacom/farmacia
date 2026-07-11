/**
 * sat.cron.js — Programación de la descarga masiva automática.
 *
 *  - Día 3 de cada mes (04:00, hora CDMX): solicita la descarga del MES ANTERIOR,
 *    emitidos y recibidos (descargaMensualAutomatica).
 *  - Cada hora: reanuda las solicitudes pendientes (el SAT genera los paquetes de
 *    forma asíncrona; aquí se verifican y se descargan cuando están listos).
 *
 * Se activa con SAT_CRON_ENABLED=true (recomendado solo en el VPS de producción,
 * para no duplicar solicitudes desde varias máquinas). Zona horaria fija CDMX.
 */
const cron = require('node-cron');
const svc = require('./sat.descarga.service');

const TZ = 'America/Mexico_City';

function initCfdiCron() {
  if (String(process.env.SAT_CRON_ENABLED).toLowerCase() !== 'true') {
    console.log('[cfdi] cron de descarga SAT deshabilitado (SAT_CRON_ENABLED!=true)');
    return;
  }

  // Día 3 de cada mes, 04:00 CDMX → solicita el mes anterior (emitidos y recibidos).
  cron.schedule('0 4 3 * *', async () => {
    try {
      const r = await svc.descargaMensualAutomatica();
      console.log('[cfdi] descarga mensual automática solicitada:', JSON.stringify(r));
    } catch (e) {
      console.error('[cfdi] error en descarga mensual automática:', e.message);
    }
  }, { timezone: TZ });

  // Cada hora → completa las solicitudes que el SAT ya tenga listas.
  cron.schedule('15 * * * *', async () => {
    try {
      const r = await svc.procesarPendientes();
      if (r.length) console.log(`[cfdi] pendientes procesadas: ${r.length}`);
    } catch (e) {
      console.error('[cfdi] error procesando pendientes:', e.message);
    }
  }, { timezone: TZ });

  console.log('[cfdi] cron de descarga SAT activo (día 3 mensual + reanudación horaria, TZ ' + TZ + ')');
}

module.exports = { initCfdiCron };
