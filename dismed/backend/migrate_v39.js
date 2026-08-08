/**
 * Migración v39 — node migrate_v39.js
 * Presentaciones de venta: un producto que se compra en un empaque (vitrolero,
 * caja) pero se vende también suelto (pieza) necesita 2+ formas de venderse,
 * cada una con su propio precio y (opcional) su propio código de barras, pero
 * compartiendo LA MISMA existencia física (siempre en piezas, vía
 * inventario_lotes — no se toca el kardex FEFO existente).
 *
 * producto_presentaciones.factor_conversion = piezas que representa una
 * unidad de esa presentación (pieza=1, vitrolero=150). Si un producto no
 * tiene filas aquí, se sigue vendiendo exactamente como hoy (sin cambio de
 * comportamiento).
 *
 * pos_ventas_partidas +presentacion_id/+presentacion_nombre/+factor_conversion:
 * snapshot de qué presentación se vendió (igual patrón que pos_citas en v38).
 * No se toca pos_ventas_partidas.cantidad ni .precio_unitario (siguen en
 * unidades/precio de la presentación vendida — el ticket ya los imprime tal
 * cual). Para no descuadrar los reportes que suman "unidades vendidas"
 * (pp.cantidad asumía piezas), se agrega piezas_equivalentes = cantidad *
 * factor_conversion, y esos reportes deben sumar esa columna en vez de
 * cantidad.
 *
 * Idempotente: CREATE TABLE / ADD COLUMN envueltos en run().
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('producto_presentaciones', `
    CREATE TABLE producto_presentaciones (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      producto_id INT UNSIGNED NOT NULL,
      nombre VARCHAR(80) NOT NULL COMMENT 'ej. "Pieza suelta", "Vitrolero"',
      factor_conversion DECIMAL(10,2) NOT NULL DEFAULT 1 COMMENT 'piezas que representa 1 unidad de esta presentación',
      precio_lista DECIMAL(12,2) NULL COMMENT 'precio propio de esta presentación; NULL = usa productos.precio_lista / factor',
      ean VARCHAR(32) NULL COMMENT 'código de barras propio (normalmente solo el empaque cerrado lo trae impreso)',
      activo_pos TINYINT(1) NOT NULL DEFAULT 1,
      orden INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_presentacion_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
      UNIQUE KEY uq_presentacion_ean (ean),
      KEY idx_presentacion_producto (producto_id, activo_pos)
    )`);

  await run('pos_ventas_partidas +presentacion_id', `
    ALTER TABLE pos_ventas_partidas ADD COLUMN presentacion_id INT UNSIGNED NULL
      COMMENT 'presentación vendida (producto_presentaciones), NULL = venta directa del producto' AFTER producto_id`);
  await run('pos_ventas_partidas +presentacion_nombre', `
    ALTER TABLE pos_ventas_partidas ADD COLUMN presentacion_nombre VARCHAR(80) NULL
      COMMENT 'snapshot de producto_presentaciones.nombre al vender' AFTER presentacion_id`);
  await run('pos_ventas_partidas +factor_conversion', `
    ALTER TABLE pos_ventas_partidas ADD COLUMN factor_conversion DECIMAL(10,2) NOT NULL DEFAULT 1
      COMMENT 'snapshot de producto_presentaciones.factor_conversion (1 = ya venía en piezas)' AFTER cantidad`);
  await run('pos_ventas_partidas +piezas_equivalentes', `
    ALTER TABLE pos_ventas_partidas ADD COLUMN piezas_equivalentes DECIMAL(12,2) NOT NULL DEFAULT 0
      COMMENT 'cantidad * factor_conversion: piezas reales que salieron del inventario (usar en reportes de unidades, no "cantidad")' AFTER factor_conversion`);
  await run('fk_partida_presentacion', `
    ALTER TABLE pos_ventas_partidas
      ADD CONSTRAINT fk_partida_presentacion FOREIGN KEY (presentacion_id) REFERENCES producto_presentaciones(id)`);
  // Backfill: partidas ya existentes vendieron 1 pieza por unidad (factor 1).
  await run('backfill piezas_equivalentes', `
    UPDATE pos_ventas_partidas SET piezas_equivalentes = cantidad WHERE piezas_equivalentes = 0`);

  console.log('\nMigración v39 terminada.');
  process.exit(0);
})();
