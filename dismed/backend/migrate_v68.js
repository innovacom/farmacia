/**
 * Migración v68 — node migrate_v68.js
 * Método de costeo de inventario configurable POR EJERCICIO + inventario final por periodo.
 *
 * El motor de pólizas reconocía el costo de ventas SOLO desde inventario_movimientos
 * (salidas del kardex, método perpetuo). Pero la contabilidad se alimenta de CFDI
 * importados cuyo costo no viene de una salida del inventario, y el CFDI de compra no
 * trae el SKU interno para ligarlo con el de venta. Con estas tablas el ejercicio puede
 * costear por método:
 *   - perpetuo  → Σ salidas del kardex (comportamiento actual, default)
 *   - periodico → Costo = Inventario inicial + Compras − Inventario final
 *   - compras   → Costo = Compras netas de mercancía del periodo (asume II ≈ IF)
 *
 * `contabilidad_inventario_periodo` guarda el inventario final valuado de cada periodo
 * (meses 1..12 mensual, 13 = cierre del ejercicio contra conteo físico). NO puede vivir
 * en una póliza: la generación borra y reconstruye las pólizas origen IN ('cfdi','inventario')
 * en cada corrida, y un valor capturado a mano se perdería.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('crea contabilidad_ejercicio', `
    CREATE TABLE IF NOT EXISTS contabilidad_ejercicio (
      anio SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
      metodo_inventario ENUM('perpetuo','periodico','compras') NOT NULL DEFAULT 'perpetuo',
      notas VARCHAR(255) NULL,
      usuario_id INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await run('crea contabilidad_inventario_periodo', `
    CREATE TABLE IF NOT EXISTS contabilidad_inventario_periodo (
      periodo_anio SMALLINT UNSIGNED NOT NULL,
      periodo_mes  TINYINT UNSIGNED NOT NULL,
      inventario_final DECIMAL(18,2) NOT NULL DEFAULT 0,
      origen ENUM('kardex','manual') NOT NULL DEFAULT 'kardex',
      notas VARCHAR(255) NULL,
      usuario_id INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (periodo_anio, periodo_mes)
    )
  `);

  console.log('\nMigración v68 terminada.');
  process.exit(0);
})();
