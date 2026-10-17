/**
 * Migración v77 — node migrate_v77.js
 * Facturación consolidada de remisiones:
 *  - entregas.pedido_id pasa a NULL (una factura consolidada puede abarcar varios pedidos).
 *  - entregas.factura_id: en una remisión apunta a la factura (entrega tipo 'factura') que la consolidó.
 *  - entregas.consolidada: 1 si la factura se generó a partir de remisiones.
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('entregas.pedido_id NULL', 'ALTER TABLE entregas MODIFY pedido_id INT UNSIGNED NULL');
  await run('entregas.factura_id', "ALTER TABLE entregas ADD COLUMN IF NOT EXISTS factura_id INT UNSIGNED NULL COMMENT 'Factura consolidada que cubre esta remisión' AFTER pedido_id");
  await run('entregas.consolidada', "ALTER TABLE entregas ADD COLUMN IF NOT EXISTS consolidada TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Factura generada desde remisiones' AFTER factura_id");
  await run('idx entregas.factura_id', 'ALTER TABLE entregas ADD INDEX idx_ent_factura (factura_id)');
  await run('fk entregas.factura_id', 'ALTER TABLE entregas ADD CONSTRAINT fk_ent_factura FOREIGN KEY (factura_id) REFERENCES entregas(id) ON UPDATE CASCADE ON DELETE SET NULL');
  await pool.end();
})();
