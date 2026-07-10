/**
 * Migración v24 — node migrate_v24.js
 * Agrega `fabricante` (VARCHAR(100)) a proveedores_catalogo: nombre del fabricante
 * del producto (distinto de referencia_fabricante, que es su código/modelo).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS (MariaDB 10.11).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('proveedores_catalogo.fabricante',
    "ALTER TABLE proveedores_catalogo ADD COLUMN IF NOT EXISTS fabricante VARCHAR(100) NULL " +
    "COMMENT 'Nombre del fabricante del producto' AFTER referencia_fabricante");

  console.log('\nMigración v24 terminada.');
  process.exit(0);
})();
