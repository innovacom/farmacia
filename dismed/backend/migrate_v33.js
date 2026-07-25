/**
 * Migración v33 — node migrate_v33.js
 * Accesos rápidos de venta mostrador: hasta 5 productos configurables por
 * sucursal (admin) que aparecen como botones en la pantalla de venta para
 * los productos más vendidos, sin necesidad de escanear o buscar.
 *
 * - sucursales.productos_favoritos: JSON con el arreglo ordenado de
 *   producto_id (máx. 5), editable desde Pos/Sucursales (pos-admin).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('sucursales.productos_favoritos',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS productos_favoritos JSON NULL
       COMMENT 'Accesos rápidos de venta mostrador: array ordenado de producto_id (máx. 5)' AFTER telefono`);

  console.log('\nMigración v33 terminada.');
  process.exit(0);
})();
