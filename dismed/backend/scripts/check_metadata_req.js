/**
 * check_metadata_req.js — Verifica/descarga una solicitud de metadata ya presentada.
 * Uso: node scripts/check_metadata_req.js <requestId>
 */
const { verificar, descargarPaquete, leerMetadataDeZip } = require('../src/modules/cfdi/sat.client');
const EJEMPLOS = ['1422DB0C-DD23-447E-8302-520C259149F7', '6273634D-AA3B-4FF1-9224-24AE8C29579A'];

(async () => {
  const requestId = process.argv[2];
  if (!requestId) { console.log('Falta requestId'); process.exit(1); }
  const v = await verificar(requestId);
  console.log('verify:', JSON.stringify({ estado: v.estado, numCfdis: v.numCfdis, paquetes: v.paquetes.length }));
  if (v.estado !== 'terminada') { console.log('Aún no termina.'); process.exit(0); }

  let total = 0, cancelados = 0; const hall = {};
  for (const pid of v.paquetes) {
    const zip = await descargarPaquete(pid);
    for await (const m of leerMetadataDeZip(zip)) {
      total++;
      if (m.estatus === 'cancelado') cancelados++;
      if (EJEMPLOS.includes(m.uuid)) hall[m.uuid] = m;
      if (total <= 3) console.log('  item:', JSON.stringify(m));
    }
  }
  console.log(`\nTotal: ${total} | vigentes: ${total - cancelados} | cancelados: ${cancelados}`);
  for (const u of EJEMPLOS) console.log(`  ${u}: ${hall[u] ? JSON.stringify(hall[u]) : 'NO en este tipo/rango'}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
