#!/usr/bin/env node
/**
 * scripts/reconciliar_estatus_rango.js — Actualiza el estatus (vigente/cancelado)
 * de los CFDI ya guardados, para un RANGO de meses, descargando la METADATA del SAT
 * (única fuente del estatus). No vuelve a bajar los XML.
 *
 * Uso:
 *   node scripts/reconciliar_estatus_rango.js 2025-12 2026-05            # ambos tipos
 *   node scripts/reconciliar_estatus_rango.js 2025-12 2026-05 recibido   # solo un tipo
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const svc = require('../src/modules/cfdi/sat.descarga.service');
const { ValidaSat } = require('../src/modules/cfdi/sat.client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIPOS_OK = ['emitido', 'recibido'];
const TERMINALES = ['descargada', 'error', 'rechazada', 'vencida'];
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(ts(), ...a);

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

async function reporte(ini) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(fecha, '%Y-%m') ym, tipo, estatus, COUNT(*) c
       FROM cfdi_repositorio
      WHERE fecha >= ?
      GROUP BY ym, tipo, estatus
      ORDER BY ym, tipo, estatus`,
    [`${ini}-01 00:00:00`]
  );
  log('REPORTE cfdi_repositorio (mes / tipo / estatus / conteo):');
  for (const r of rows) console.log(`   ${r.ym}  ${r.tipo.padEnd(9)} ${r.estatus.padEnd(11)} ${r.c}`);
}

(async () => {
  const [ini, fin, tipoArg] = process.argv.slice(2);
  const meses = ini && fin ? rangoMeses(ini, fin) : null;
  if (!meses) {
    console.error('Uso: node scripts/reconciliar_estatus_rango.js <YYYY-MM> <YYYY-MM> [emitido|recibido]');
    process.exit(2);
  }
  const tipos = tipoArg && TIPOS_OK.includes(tipoArg) ? [tipoArg] : TIPOS_OK;
  log(`Reconciliar estatus | rango: ${meses.join(', ')} | tipos: ${tipos.join(', ')}`);

  let fiel;
  try { fiel = await ValidaSat(); }
  catch (e) { console.error('ValidaSat error:', e.message); process.exit(1); }
  log('FIEL:', JSON.stringify(fiel));
  if (!fiel.valida) { console.error('La e.firma no es válida o está vencida. Abortado.'); process.exit(1); }

  // Solicitar METADATA por mes y tipo, y esperar a que el SAT la entregue.
  for (const mes of meses) {
    const [y, m] = mes.split('-').map(Number);
    const { desde, hasta } = svc.periodoMes(y, m);
    for (const tipo of tipos) {
      const k = `${mes}/${tipo}`;
      try {
        const j = await svc.solicitarDescarga({ tipo, desde, hasta, requestType: 'metadata', origen: 'estatus' });
        log(`[${k}] metadata solicitud:`, JSON.stringify(j));
        if (j.estado === 'en_proceso') {
          const r = await svc.procesarConEspera(j.id, { maxWaitMs: 600000, intervalMs: 20000 });
          log(`[${k}] metadata final:`, JSON.stringify(r));
        }
      } catch (e) {
        console.error(`[${k}] error:`, e.message);
      }
    }
  }

  // Empujar cualquier job de metadata que el SAT haya tardado en entregar.
  for (let i = 1; i <= 10; i++) {
    const p = await svc.procesarPendientes();
    const pend = p.filter((x) => !TERMINALES.includes(x.estado));
    log(`procesarPendientes pase ${i}: ${pend.length} pendiente(s)`);
    if (!pend.length) break;
    await sleep(30000);
  }

  await reporte(ini);
  log('LISTO');
  process.exit(0);
})();
