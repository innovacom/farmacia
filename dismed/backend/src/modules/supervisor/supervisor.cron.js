/**
 * supervisor.cron.js — Cada 10 minutos evalúa los umbrales del Panel de
 * Supervisor (una por empresa) y manda la alerta agrupada por WhatsApp si
 * hace falta (ver supervisor.alertas.service#enviar, que ya deduplica por
 * firma). Respeta la franja horaria configurable (alertas_hora_inicio/_fin,
 * default 8-21) para no despertar a nadie de madrugada — por eso el filtro
 * va en código y no en la expresión del cron.
 * Se activa con SUPERVISOR_ALERTAS_ENABLED=true (igual que SAT_CRON_ENABLED
 * para la descarga de CFDI: solo en el VPS de producción).
 */
const cron = require('node-cron');
const { pool } = require('../../config/db');
const umbralesSvc = require('./supervisor.umbrales.service');
const alertasSvc = require('./supervisor.alertas.service');

const TZ = 'America/Mexico_City';

async function dentroDeHorario(empresaId) {
  const horaActual = Number(
    new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })
  );
  const inicio = await umbralesSvc.resolver(empresaId, null, 'alertas_hora_inicio');
  const fin = await umbralesSvc.resolver(empresaId, null, 'alertas_hora_fin');
  return horaActual >= inicio && horaActual < fin;
}

function initSupervisorCron() {
  if (String(process.env.SUPERVISOR_ALERTAS_ENABLED).toLowerCase() !== 'true') {
    console.log('[supervisor] cron de alertas deshabilitado (SUPERVISOR_ALERTAS_ENABLED!=true)');
    return;
  }

  cron.schedule('*/10 * * * *', async () => {
    try {
      const [empresas] = await pool.query('SELECT id FROM empresas');
      for (const { id: empresaId } of empresas) {
        if (!(await dentroDeHorario(empresaId))) continue;
        const r = await alertasSvc.enviar(empresaId);
        if (r.enviado) console.log(`[supervisor] alerta enviada, empresa ${empresaId}: ${r.alertas.length} ítem(s)`);
      }
    } catch (e) {
      console.error('[supervisor] error evaluando alertas:', e.message);
    }
  }, { timezone: TZ });

  console.log('[supervisor] cron de alertas activo (cada 10 min, TZ ' + TZ + ')');
}

module.exports = { initSupervisorCron };
