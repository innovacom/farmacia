/**
 * test_sat_metadata.js — Descarga METADATA del SAT (con estatus vigente/cancelado)
 * y verifica el formato + UUIDs de ejemplo. Sin BD.
 * Uso: node scripts/test_sat_metadata.js [emitido|recibido] [desde 'YYYY-MM-DD'] [hasta 'YYYY-MM-DD']
 */
const { solicitar, verificar, descargarPaquete, leerMetadataDeZip } = require('../src/modules/cfdi/sat.client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EJEMPLOS = ['1422DB0C-DD23-447E-8302-520C259149F7', '6273634D-AA3B-4FF1-9224-24AE8C29579A'];

(async () => {
  const tipo = (process.argv[2] || 'emitido').toLowerCase();
  const desde = (process.argv[3] || '2023-01-01') + ' 00:00:00';
  const hasta = (process.argv[4] || '2026-06-30') + ' 23:59:59';

  console.log(`== Solicitando METADATA (${tipo}) ${desde} → ${hasta} ==`);
  const sol = await solicitar({ tipo, desde, hasta, requestType: 'metadata' });
  console.log(JSON.stringify(sol));
  if (!sol.aceptada) return process.exit(1);

  let v;
  for (let i = 0; i < 20; i++) {
    await sleep(20000);
    v = await verificar(sol.requestId);
    console.log(`  intento ${i + 1}: estado=${v.estado} cfdis=${v.numCfdis} paquetes=${v.paquetes.length}`);
    if (['terminada', 'error', 'rechazada', 'vencida'].includes(v.estado)) break;
  }
  if (!v || v.estado !== 'terminada') { console.log('No terminó. requestId=' + sol.requestId); return process.exit(0); }

  let total = 0, cancelados = 0;
  const ejemplosHallados = {};
  for (const pid of v.paquetes) {
    const zip = await descargarPaquete(pid);
    for await (const m of leerMetadataDeZip(zip)) {
      total++;
      if (m.estatus === 'cancelado') cancelados++;
      if (EJEMPLOS.includes(m.uuid)) ejemplosHallados[m.uuid] = m;
      if (total <= 2) console.log('  muestra item:', JSON.stringify(m));
    }
  }
  console.log(`\nTotal metadata: ${total} | vigentes: ${total - cancelados} | cancelados: ${cancelados}`);
  console.log('== UUIDs de ejemplo ==');
  for (const u of EJEMPLOS) console.log(`  ${u}: ${ejemplosHallados[u] ? JSON.stringify(ejemplosHallados[u]) : 'NO encontrado en este tipo/rango'}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
