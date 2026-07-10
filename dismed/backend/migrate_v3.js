/**
 * Migración v3 — node migrate_v3.js
 * ADD codigo_gobierno a solicitudes_partidas
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
  try {
    await pool.query(
      `ALTER TABLE solicitudes_partidas
       ADD COLUMN IF NOT EXISTS codigo_gobierno VARCHAR(80) NULL
       AFTER codigo_cliente`
    );
    console.log('OK  solicitudes_partidas.codigo_gobierno agregado');
  } catch (e) {
    console.log('INFO', e.message);
  }
  process.exit(0);
})();
