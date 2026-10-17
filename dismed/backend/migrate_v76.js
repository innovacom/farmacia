/**
 * Migración v76 — node migrate_v76.js
 * clientes.forma_pago / clientes.metodo_pago: valores por defecto (catálogo SAT) que el
 * modal de factura precarga junto con clientes.uso_cfdi. Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
  for (const [col, ddl] of [
    ['forma_pago', "VARCHAR(2) NULL COMMENT 'c_FormaPago por defecto para facturar' AFTER uso_cfdi"],
    ['metodo_pago', "VARCHAR(3) NULL COMMENT 'PUE o PPD por defecto para facturar' AFTER forma_pago"],
  ]) {
    try {
      await pool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ${col} ${ddl}`);
      console.log('OK  clientes.' + col);
    } catch (e) { console.log('INFO clientes.' + col + ' — ' + e.message); }
  }
  await pool.end();
})();
