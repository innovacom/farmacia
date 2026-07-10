/**
 * test_sat_descarga.js — Prueba real contra el SAT (Descarga Masiva).
 * Presenta UNA consulta y la verifica una vez. No descarga (el SAT tarda).
 * Uso: node scripts/test_sat_descarga.js [emitido|recibido] [YYYY-MM]
 */
const { validarFiel, solicitar, verificar } = require('../src/modules/cfdi/sat.client');

function periodoMes(ym) {
  // ym 'YYYY-MM' → primer/último segundo del mes
  const [y, m] = (ym || '').split('-').map(Number);
  let yy = y, mm = m;
  if (!yy || !mm) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1); // mes anterior
    yy = d.getFullYear(); mm = d.getMonth() + 1;
  }
  const last = new Date(yy, mm, 0).getDate();
  const p = (n) => String(n).padStart(2, '0');
  return {
    desde: `${yy}-${p(mm)}-01 00:00:00`,
    hasta: `${yy}-${p(mm)}-${p(last)} 23:59:59`,
  };
}

(async () => {
  const tipo = (process.argv[2] || 'recibido').toLowerCase();
  const { desde, hasta } = periodoMes(process.argv[3]);
  console.log('== Validando FIEL ==');
  console.log(JSON.stringify(await validarFiel()));

  console.log(`\n== Solicitando descarga (${tipo}) ${desde} → ${hasta} ==`);
  const sol = await solicitar({ tipo, desde, hasta });
  console.log(JSON.stringify(sol, null, 2));
  if (!sol.aceptada) { console.log('Solicitud NO aceptada. Fin.'); process.exit(0); }

  console.log('\n== Verificando solicitud (1ra vez, normalmente "en_proceso") ==');
  const v = await verificar(sol.requestId);
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
