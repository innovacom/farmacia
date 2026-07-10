/**
 * Migración v22 — node migrate_v22.js
 * Agrega el origen 'apertura' a polizas, para la póliza de saldos iniciales
 * (balanza del contador al 31-ene-2026). El generador de pólizas solo borra/regenera
 * las de origen 'cfdi'/'inventario', así que la apertura se preserva siempre.
 *
 * Idempotente: MODIFY COLUMN se puede correr varias veces sin efecto adverso.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('polizas.origen += apertura',
    "ALTER TABLE polizas MODIFY origen " +
    "ENUM('cfdi','inventario','manual','apertura') NOT NULL DEFAULT 'cfdi' " +
    "COMMENT 'cfdi/inventario=autogenerada; apertura=saldos iniciales; manual=a mano'");

  console.log('\nMigración v22 terminada.');
  process.exit(0);
})();
