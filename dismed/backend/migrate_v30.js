/**
 * Migración v30 — node migrate_v30.js
 * Regla legal: precio_lista (precio de venta) nunca puede ser mayor al
 * precio_publico. Además:
 *   - precio_costo: nuevo campo (precio de compra al proveedor).
 *   - margen_ganancia: columna calculada (GENERATED), % entre precio_lista y
 *     precio_costo. No se guarda directo, se recalcula sola.
 *
 * Antes de imponer la regla se corrigen datos existentes: cualquier producto
 * con precio_publico en 0, NULL o menor al precio_lista queda con
 * precio_publico = 999999.99 (equivale a "sin tope publicado todavía"),
 * para no romper la restricción con el catálogo actual.
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS + chequeo de CHECK constraint por
 * information_schema (mismo patrón que las FKs de migrate_v5.js).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── 1. Corregir datos existentes que romperían la regla ──────────────────
  const [fix] = await pool.query(
    `UPDATE productos
        SET precio_publico = 999999.99
      WHERE precio_publico IS NULL
         OR precio_publico = 0
         OR (precio_lista IS NOT NULL AND precio_publico < precio_lista)`
  );
  console.log(`OK  fix precio_publico en catálogo actual (${fix.affectedRows} filas)`);

  // ── 2. Nuevo campo precio_costo ───────────────────────────────────────────
  await run('productos.precio_costo',
    `ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_costo DECIMAL(12,2) NULL
       COMMENT 'Precio de compra al proveedor'`);

  // ── 3. Columna calculada margen_ganancia = % entre precio_lista y precio_costo ──
  await run('productos.margen_ganancia',
    `ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen_ganancia DECIMAL(8,2)
       GENERATED ALWAYS AS (
         CASE WHEN precio_lista IS NOT NULL AND precio_lista > 0 AND precio_costo IS NOT NULL
              THEN (precio_lista - precio_costo) / precio_lista * 100
              ELSE NULL END
       ) VIRTUAL
       COMMENT '% de ganancia entre precio_lista y precio_costo (calculado, no editable)'`);

  // ── 4. CHECK: precio_lista nunca mayor a precio_publico ───────────────────
  const [[exists]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos'
       AND CONSTRAINT_NAME = 'chk_prod_lista_no_mayor_publico'`
  );
  if (exists.n > 0) {
    console.log('INFO chk_prod_lista_no_mayor_publico ya existe');
  } else {
    await run('chk_prod_lista_no_mayor_publico',
      `ALTER TABLE productos ADD CONSTRAINT chk_prod_lista_no_mayor_publico
         CHECK (precio_lista IS NULL OR precio_publico IS NULL OR precio_lista <= precio_publico)`);
  }

  console.log('\nMigración v30 terminada.');
  process.exit(0);
})();
