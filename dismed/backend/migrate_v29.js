/**
 * Migración v29 — node migrate_v29.js
 * Fix: al editar un producto con una unidad de venta cuyo nombre supera los 30
 * caracteres, MySQL rechazaba el UPDATE con "Data too long for column
 * 'unidad_medida'". `unidades_medida.nombre` es VARCHAR(40) (migrate_v5) pero
 * `unidad_medida` en productos/solicitudes_partidas/cotizaciones_cliente_partidas
 * seguía en VARCHAR(30) (dismed_schema_v2.sql). Se amplía a VARCHAR(60) con
 * margen para nombres largos.
 *
 * Idempotente: MODIFY COLUMN no falla si ya tiene el tamaño nuevo.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('productos.unidad_medida -> VARCHAR(60)',
    `ALTER TABLE productos MODIFY unidad_medida VARCHAR(60) NOT NULL DEFAULT 'pza'`);

  await run('solicitudes_partidas.unidad_medida -> VARCHAR(60)',
    `ALTER TABLE solicitudes_partidas MODIFY unidad_medida VARCHAR(60) NOT NULL DEFAULT 'pza'`);

  await run('cotizaciones_cliente_partidas.unidad_medida -> VARCHAR(60)',
    `ALTER TABLE cotizaciones_cliente_partidas MODIFY unidad_medida VARCHAR(60) NOT NULL DEFAULT 'pza'`);

  console.log('\nMigración v29 terminada.');
  process.exit(0);
})();
