/* Prueba funcional del caché de precios web contra la BD local.
 * Ejecuta: node test_precios_cache.js  (requiere migrate_v16 aplicada)
 * Inserta una búsqueda, la recupera, prueba vigencia y limpia. */
require('dotenv').config();
const { pool } = require('./src/config/db');
const cache = require('./src/modules/solicitudes/precios.cache');
const { getVigencias } = require('./src/config/precios');

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; console.log('  OK  ' + m); } else { fail++; console.error('  FAIL ' + m); } };

const partida = {
  descripcion_original: 'JERINGA DESECHABLE 5 ML CON AGUJA 22G TEST_CACHE',
  codigo_cliente: 'CLI-TESTC-001',
  codigo_gobierno: 'GOB-TESTC-001',
};
const ident = { producto: 'Jeringa 5ml', referencia_fabricante: 'REF-TC-5ML', clave_cuadro_basico: '060.123.4567' };
const ofertas = [
  { tienda: 'MediFacil', url: 'https://medifacil.com/jeringa-5ml', precio_mxn: 12.5, notas: 'caja/100' },
  { tienda: 'Mercado Libre', url: 'https://ml.com.mx/jeringa', precio_mxn: 9.9, notas: '' },
];

(async () => {
  try {
    // limpieza previa por si quedó de una corrida anterior
    await pool.query("DELETE FROM precios_web_cache WHERE descripcion_original LIKE '%TEST_CACHE%'");

    // 1) miss inicial
    const miss = await cache.buscarEnCache(partida);
    assert(miss === null, 'sin datos: buscarEnCache devuelve null');

    // 2) guardar
    await cache.guardarEnCache(partida, ident, ofertas);
    const [[cnt]] = await pool.query("SELECT COUNT(*) n FROM precios_web_cache WHERE descripcion_original LIKE '%TEST_CACHE%'");
    assert(cnt.n === 2, `guardarEnCache insertó 2 filas (insertó ${cnt.n})`);

    // 3) hit por descripción
    const hit = await cache.buscarEnCache(partida);
    assert(hit && hit.ofertas.length === 2, 'hit por descripción devuelve 2 ofertas');
    assert(hit && hit.identificacion.referencia_fabricante === 'REF-TC-5ML', 'recupera referencia_fabricante');
    assert(hit && hit.fecha_busqueda, 'devuelve fecha_busqueda: ' + (hit && hit.fecha_busqueda));

    // 4) hit por código de gobierno aunque cambie la descripción
    const hit2 = await cache.buscarEnCache({ descripcion_original: 'OTRA COSA DISTINTA', codigo_gobierno: 'GOB-TESTC-001' });
    assert(hit2 && hit2.ofertas.length === 2, 'hit por codigo_gobierno (descripción distinta)');

    // 5) vigencia web: envejecer las filas más allá de la ventana web -> ya no debe haber hit
    const { vigencia_web_meses } = await getVigencias();
    await pool.query(
      "UPDATE precios_web_cache SET fecha_busqueda = DATE_SUB(CURDATE(), INTERVAL ? MONTH) WHERE descripcion_original LIKE '%TEST_CACHE%'",
      [vigencia_web_meses + 1]
    );
    const expirado = await cache.buscarEnCache(partida);
    assert(expirado === null, `precios web > ${vigencia_web_meses} meses ya no se reutilizan (vencidos)`);

    // limpieza
    await pool.query("DELETE FROM precios_web_cache WHERE descripcion_original LIKE '%TEST_CACHE%'");
    console.log(`\nResultado: ${ok} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('ERROR inesperado:', e);
    process.exit(1);
  }
})();
