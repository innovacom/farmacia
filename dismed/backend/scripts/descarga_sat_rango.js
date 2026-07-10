#!/usr/bin/env node
/**
 * scripts/descarga_sat_rango.js — Descarga masiva de CFDI del SAT para un RANGO de
 * meses (emitidos y recibidos) y empuja la reconciliación de estatus de esos meses.
 *
 * Pensado para corridas grandes en segundo plano (nohup/setsid). Reutiliza el
 * servicio del módulo cfdi; valida la e.firma con ValidaSat antes de empezar.
 *
 * Uso:
 *   node scripts/descarga_sat_rango.js 2025-12 2026-05            # ambos tipos
 *   node scripts/descarga_sat_rango.js 2025-12 2026-05 emitido    # solo un tipo
 */
const svc = require('../src/modules/cfdi/sat.descarga.service');
const { ValidaSat } = require('../src/modules/cfdi/sat.client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIPOS_OK = ['emitido', 'recibido'];
const TERMINALES = ['descargada', 'error', 'rechazada', 'vencida'];
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(ts(), ...a);

/** Lista de meses 'YYYY-MM' de inicio a fin (inclusive). */
function rangoMeses(ini, fin) {
  const m = /^(\d{4})-(\d{2})$/;
  const a = m.exec(ini), b = m.exec(fin);
  if (!a || !b) return null;
  let y = +a[1], mo = +a[2];
  const yf = +b[1], mof = +b[2];
  if (mo < 1 || mo > 12 || mof < 1 || mof > 12) return null;
  if (y > yf || (y === yf && mo > mof)) return null;
  const out = [];
  while (y < yf || (y === yf && mo <= mof)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

(async () => {
  const [ini, fin, tipoArg] = process.argv.slice(2);
  const meses = ini && fin ? rangoMeses(ini, fin) : null;
  if (!meses) {
    console.error('Uso: node scripts/descarga_sat_rango.js <YYYY-MM> <YYYY-MM> [emitido|recibido]');
    process.exit(2);
  }
  const tipos = tipoArg && TIPOS_OK.includes(tipoArg) ? [tipoArg] : TIPOS_OK;
  log(`Rango: ${meses.join(', ')} | tipos: ${tipos.join(', ')}`);

  // 1) Validar la e.firma una sola vez.
  let fiel;
  try { fiel = await ValidaSat(); }
  catch (e) { console.error('ValidaSat error:', e.message); process.exit(1); }
  log('FIEL:', JSON.stringify(fiel));
  if (!fiel.valida) { console.error('La e.firma no es válida o está vencida. Abortado.'); process.exit(1); }

  // 2) Solicitar + esperar por cada mes y tipo. Al terminar el XML, el servicio
  //    encola solo la reconciliación de estatus (metadata) de ese mismo periodo.
  const resumen = {};
  for (const mes of meses) {
    const [y, m] = mes.split('-').map(Number);
    const { desde, hasta } = svc.periodoMes(y, m);
    for (const tipo of tipos) {
      const k = `${mes}/${tipo}`;
      try {
        const j = await svc.solicitarDescarga({ tipo, desde, hasta, origen: 'manual' });
        log(`[${k}] solicitud:`, JSON.stringify(j));
        if (j.estado === 'en_proceso') {
          const r = await svc.procesarConEspera(j.id, { maxWaitMs: 600000, intervalMs: 20000 });
          log(`[${k}] final:`, JSON.stringify(r));
          resumen[k] = r;
        } else {
          resumen[k] = j;
        }
      } catch (e) {
        console.error(`[${k}] error:`, e.message);
        resumen[k] = { estado: 'error', mensaje: e.message };
      }
    }
  }

  // 3) Empujar TODO lo pendiente (descargas lentas del SAT + reconciliaciones de
  //    estatus encoladas) hasta que todo quede en estado terminal o agotar pases.
  for (let i = 1; i <= 10; i++) {
    const p = await svc.procesarPendientes();
    const pend = p.filter((x) => !TERMINALES.includes(x.estado));
    log(`procesarPendientes pase ${i}: ${pend.length} pendiente(s)`);
    if (!pend.length) break;
    await sleep(30000);
  }

  log('RESUMEN:', JSON.stringify(resumen));
  log('LISTO');
  process.exit(0);
})();
