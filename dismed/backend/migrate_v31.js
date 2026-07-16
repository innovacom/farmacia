/**
 * Migración v31 — node migrate_v31.js
 * Nuevo estatus `vendible` en productos: un producto sin precio_lista capturado
 * no debe poder venderse (POS ni cotizaciones a cliente), aunque sí puede
 * recibirse en inventario. Lo introduce la carga automática de facturas
 * (CFDI XML de proveedor): da de alta productos nuevos con solo costo, sin
 * precio de venta, y esos deben quedar bloqueados para venta hasta que alguien
 * les capture precio en el Catálogo de productos.
 *
 * productos.controller.js recalcula `vendible` automáticamente cuando cambia
 * precio_lista (create/update); también es editable a mano (override admin).
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
  await run('productos.vendible',
    `ALTER TABLE productos ADD COLUMN IF NOT EXISTS vendible TINYINT(1) NOT NULL DEFAULT 1
       COMMENT 'Si no tiene precio_lista, no se puede vender en POS ni cotizaciones' AFTER precio_lista`);

  // Backfill: catálogo existente sin precio de venta capturado queda bloqueado para venta.
  const [fix] = await pool.query(
    `UPDATE productos SET vendible = 0 WHERE precio_lista IS NULL`
  );
  console.log(`OK  fix vendible=0 en productos sin precio_lista (${fix.affectedRows} filas)`);

  console.log('\nMigración v31 terminada.');
  process.exit(0);
})();
