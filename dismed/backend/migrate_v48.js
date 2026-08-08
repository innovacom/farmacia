/**
 * Migración v48 — node migrate_v48.js
 * v_existencias no exponía p.ean ni p.fabricante, así que la búsqueda por EAN
 * en Existencias/Movimientos de inventario (inventario.controller#existencias)
 * nunca podía encontrar nada y no había forma de filtrar por fabricante.
 * Solo agrega columnas a la vista (CREATE OR REPLACE VIEW), no toca datos.
 *
 * Idempotente: cada sentencia envuelta en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('v_existencias (+ean +fabricante)', `
    CREATE OR REPLACE VIEW v_existencias AS
    SELECT
      il.id                AS lote_id,
      il.producto_id,
      p.sku_interno,
      p.descripcion,
      p.ean,
      p.fabricante,
      p.control_lote_caducidad,
      p.unidad_medida,
      il.numero_lote,
      il.es_generico,
      il.fecha_caducidad,
      il.almacen_id,
      a.nombre             AS almacen,
      il.ubicacion_id,
      u.codigo             AS ubicacion,
      il.cantidad_actual,
      il.costo_unitario,
      (il.cantidad_actual * il.costo_unitario) AS valor,
      DATEDIFF(il.fecha_caducidad, CURDATE())   AS dias_caducidad,
      CASE
        WHEN il.fecha_caducidad IS NULL                          THEN 'SIN_CADUCIDAD'
        WHEN il.fecha_caducidad <= CURDATE()                     THEN 'CADUCADO'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 30       THEN 'ALERTA_30'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 60       THEN 'ALERTA_60'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 90       THEN 'ALERTA_90'
        ELSE 'OK'
      END                  AS estado_caducidad
    FROM inventario_lotes il
    JOIN productos p        ON p.id = il.producto_id
    LEFT JOIN almacenes a   ON a.id = il.almacen_id
    LEFT JOIN ubicaciones u ON u.id = il.ubicacion_id`);

  console.log('\nMigración v48 terminada.');
  process.exit(0);
})();
