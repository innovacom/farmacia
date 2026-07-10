#!/usr/bin/env node
/**
 * scripts/descarga_sat.js — Descarga masiva de CFDI del SAT a demanda.
 *
 * Lo invoca la skill /descarga-sat (por SSH contra el VPS). Reutiliza el servicio
 * del módulo cfdi; no duplica lógica. Valida la e.firma con ValidaSat antes de
 * gastar una solicitud y luego solicita + espera por cada tipo.
 *
 * Uso:
 *   node scripts/descarga_sat.js 2026-05                  # mes completo, emitidos+recibidos
 *   node scripts/descarga_sat.js 2026-05 emitido          # solo un tipo
 *   node scripts/descarga_sat.js 2026-05-01 2026-05-15    # rango de fechas
 *   node scripts/descarga_sat.js 2026-05-01 2026-05-15 recibido
 */
const svc = require('../src/modules/cfdi/sat.descarga.service');
const { ValidaSat } = require('../src/modules/cfdi/sat.client');

const TIPOS_OK = ['emitido', 'recibido'];

function parseArgs(argv) {
  const args = argv.slice(2);
  let tipos = TIPOS_OK;
  // El último argumento puede ser un tipo concreto.
  if (args.length && TIPOS_OK.includes(args[args.length - 1])) {
    tipos = [args.pop()];
  }
  // Mes: YYYY-MM
  if (args.length === 1 && /^\d{4}-\d{2}$/.test(args[0])) {
    const [y, m] = args[0].split('-').map(Number);
    const { desde, hasta } = svc.periodoMes(y, m);
    return { desde, hasta, tipos };
  }
  // Rango: YYYY-MM-DD YYYY-MM-DD
  if (args.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(args[0]) && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
    return { desde: `${args[0]} 00:00:00`, hasta: `${args[1]} 23:59:59`, tipos };
  }
  return null;
}

(async () => {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error('Uso: node scripts/descarga_sat.js <YYYY-MM | YYYY-MM-DD YYYY-MM-DD> [emitido|recibido]');
    process.exit(2);
  }
  const { desde, hasta, tipos } = parsed;
  console.log(`Periodo: ${desde} -> ${hasta} | tipos: ${tipos.join(', ')}`);

  // 1) Validar la e.firma antes de gastar una solicitud ante el SAT.
  let fiel;
  try { fiel = await ValidaSat(); }
  catch (e) { console.error('ValidaSat error:', e.message); process.exit(1); }
  console.log('FIEL:', JSON.stringify(fiel));
  if (!fiel.valida) { console.error('La e.firma no es válida o está vencida. Abortado.'); process.exit(1); }

  // 2) Solicitar + esperar por cada tipo (el SAT es asíncrono; procesarConEspera reanuda).
  const resumen = {};
  for (const tipo of tipos) {
    try {
      const j = await svc.solicitarDescarga({ tipo, desde, hasta, origen: 'manual' });
      console.log(`[${tipo}] solicitud:`, JSON.stringify(j));
      if (j.estado === 'en_proceso') {
        const fin = await svc.procesarConEspera(j.id);
        console.log(`[${tipo}] final:`, JSON.stringify(fin));
        resumen[tipo] = fin;
      } else {
        resumen[tipo] = j;
      }
    } catch (e) {
      console.error(`[${tipo}] error:`, e.message);
      resumen[tipo] = { estado: 'error', mensaje: e.message };
    }
  }

  console.log('RESUMEN:', JSON.stringify(resumen));
  process.exit(0);
})();
