/**
 * Migración v79 — node migrate_v79.js
 * Serie de facturación CFDI: clientes.serie_facturacion (default del cliente, y la que usan las
 * facturas consolidadas) y clientes_sucursales.serie_facturacion (la de cada sucursal).
 * Las series disponibles se administran en Configuración (clave `cfdi_series`). Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('clientes.serie_facturacion',
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS serie_facturacion VARCHAR(10) NULL COMMENT 'Serie CFDI por defecto; también la de facturas consolidadas'");
  await run('clientes_sucursales.serie_facturacion',
    "ALTER TABLE clientes_sucursales ADD COLUMN IF NOT EXISTS serie_facturacion VARCHAR(10) NULL COMMENT 'Serie CFDI de la sucursal (vacío = la del cliente)'");
  await pool.end();
})();
