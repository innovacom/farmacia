/**
 * Migración v18 — node migrate_v18.js
 * Ensancha cfdi_repositorio.condiciones_pago: VARCHAR(100) -> VARCHAR(1000).
 *
 * Motivo: algunos CFDI (sobre todo recibidos) traen CondicionesDePago largas y
 * fallaban al guardarse con "Data too long for column 'condiciones_pago'",
 * perdiéndose el comprobante. El campo del SAT es texto libre.
 *
 * Idempotente: MODIFY COLUMN se puede correr varias veces sin efecto adverso.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cfdi_repositorio.condiciones_pago -> VARCHAR(1000)',
    "ALTER TABLE cfdi_repositorio MODIFY condiciones_pago VARCHAR(1000) NULL");

  console.log('\nMigración v18 terminada.');
  process.exit(0);
})();
