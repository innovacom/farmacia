/**
 * test_sat_full.js — Ciclo completo contra el SAT SIN tocar la BD:
 * solicita → espera (poll verify) → descarga paquetes → parsea XML → imprime.
 * Sirve para validar cliente + parser con XML real del SAT.
 * Uso: node scripts/test_sat_full.js [emitido|recibido] [YYYY-MM]
 */
const { solicitar, verificar, descargarPaquete, leerCfdisDeZip } = require('../src/modules/cfdi/sat.client');
const { parseCfdi } = require('../src/modules/cfdi/cfdi.parser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function periodoMes(ym) {
  const [y, m] = (ym || '').split('-').map(Number);
  let yy = y, mm = m;
  if (!yy || !mm) { const d = new Date(); d.setMonth(d.getMonth() - 1); yy = d.getFullYear(); mm = d.getMonth() + 1; }
  const last = new Date(yy, mm, 0).getDate();
  const p = (n) => String(n).padStart(2, '0');
  return { desde: `${yy}-${p(mm)}-01 00:00:00`, hasta: `${yy}-${p(mm)}-${p(last)} 23:59:59` };
}

(async () => {
  const tipo = (process.argv[2] || 'recibido').toLowerCase();
  const { desde, hasta } = periodoMes(process.argv[3] || '2024-03');

  console.log(`== Solicitando (${tipo}) ${desde} → ${hasta} ==`);
  const sol = await solicitar({ tipo, desde, hasta });
  console.log(JSON.stringify(sol));
  if (!sol.aceptada) return process.exit(1);

  console.log('== Esperando a que el SAT genere los paquetes (poll cada 20s, máx 15) ==');
  let v;
  for (let i = 0; i < 15; i++) {
    await sleep(20000);
    v = await verificar(sol.requestId);
    console.log(`  intento ${i + 1}: estado=${v.estado} cfdis=${v.numCfdis} paquetes=${v.paquetes.length}`);
    if (['terminada', 'error', 'rechazada', 'vencida'].includes(v.estado)) break;
  }
  if (!v || v.estado !== 'terminada') { console.log('No terminó en el tiempo de espera. requestId=' + sol.requestId); return process.exit(0); }

  console.log(`== Descargando ${v.paquetes.length} paquete(s) y parseando ==`);
  let n = 0, primero = null;
  for (const pid of v.paquetes) {
    const zip = await descargarPaquete(pid);
    console.log(`  paquete ${pid}: ${zip.length} bytes`);
    for await (const { name, xml } of leerCfdisDeZip(zip)) {
      n++;
      if (!primero) { try { primero = parseCfdi(xml); } catch (e) { console.log('  parse err:', e.message); } }
    }
  }
  console.log(`\nTotal XML en paquetes: ${n}`);
  if (primero) {
    console.log('\n== Primer CFDI parseado (encabezado) ==');
    console.log(JSON.stringify(primero.comprobante, null, 2));
    console.log(`== Conceptos: ${primero.conceptos.length} (muestra 1) ==`);
    console.log(JSON.stringify(primero.conceptos[0], null, 2));
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
