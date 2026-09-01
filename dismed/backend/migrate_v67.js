/**
 * Migración v67 — node migrate_v67.js
 * Radio de cobertura de entrega a domicilio (km), configurable por admin.
 *
 * Se agrega a la tabla `configuracion` (ver migrate_v17) el parámetro
 * `radio_cobertura_km` (default 2, el mismo valor que ya se le prometía al
 * cliente en la FAQ del chatbot de WhatsApp — ver migrate_v44, pregunta de
 * "área de cobertura"). A partir de esta migración el valor SÍ se verifica de
 * verdad contra la dirección del cliente (geocodificación + distancia línea
 * recta contra sucursales.latitud/longitud, ver src/services/cobertura.service.js),
 * en vez de ser solo una respuesta de texto fija sin validar.
 *
 * Idempotente: INSERT IGNORE (no pisa el valor si el admin ya lo cambió).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('seed radio_cobertura_km=2', `
    INSERT IGNORE INTO configuracion (clave, valor, descripcion)
    VALUES ('radio_cobertura_km', '2',
            'Radio máximo (km) para aceptar entrega a domicilio, medido desde las coordenadas de la sucursal')
  `);

  console.log('\nMigración v67 terminada.');
  process.exit(0);
})();
