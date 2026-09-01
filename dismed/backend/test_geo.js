/* Prueba de geocodificación real contra Google Geocoding API (requiere GOOGLE_MAPS_API_KEY
   en .env, restringida por IP y con "Geocoding API" habilitada) y del cálculo de cobertura
   contra sucursales.latitud/longitud. Hace llamadas reales a internet — no forma parte de un
   CI, es un smoke test manual (mismo patrón que test_ai_provider.js). */
require('dotenv').config();
const geo = require('./src/config/geo');
const { pool } = require('./src/config/db');
const coberturaService = require('./src/services/cobertura.service');

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('  OK  ' + m); } else { fail++; console.error('  FAIL ' + m); } };

(async () => {
  try {
    assert(!!process.env.GOOGLE_MAPS_API_KEY, 'GOOGLE_MAPS_API_KEY configurada en .env');

    const punto = await geo.geocodificar('Palacio de Bellas Artes, Ciudad de México');
    assert(!!punto, 'geocodificar() devuelve coordenadas para una dirección real');
    if (punto) console.log('    ->', punto);

    const [[suc]] = await pool.query('SELECT id, empresa_id, latitud, longitud FROM sucursales LIMIT 1');
    assert(!!suc, 'hay al menos una sucursal en la BD');
    if (suc) console.log('    sucursal de prueba:', suc);

    if (suc) {
      const cerca = await coberturaService.verificarCobertura(suc.empresa_id, suc.id, 'Palacio de Bellas Artes, Ciudad de México');
      console.log('    verificarCobertura (dirección de referencia):', cerca);
      assert(cerca.motivo === 'verificado', 'verificarCobertura hace una verificación real (no cae en sin_verificar)');
    }

    console.log(`\nResultado: ${ok} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('ERROR inesperado:', e);
    process.exit(1);
  }
})();
