/**
 * Migración v23 — node migrate_v23.js
 * Estado de revisión de las pólizas: 'borrador' (recién generada) | 'confirmada'
 * (revisada por el usuario). La apertura se marca confirmada de entrada.
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
  await run('polizas.estado',
    "ALTER TABLE polizas ADD COLUMN IF NOT EXISTS estado " +
    "ENUM('borrador','confirmada') NOT NULL DEFAULT 'borrador' " +
    "COMMENT 'borrador=recién generada; confirmada=revisada por el usuario'");

  await run('polizas.apertura -> confirmada',
    "UPDATE polizas SET estado='confirmada' WHERE origen='apertura'");

  console.log('\nMigración v23 terminada.');
  process.exit(0);
})();
