/**
 * Migración v4 — node migrate_v4.js
 *   · solicitudes_partidas → ADD iva_exento (bandera para calcular o no IVA por partida)
 *   · v_comparador_precios → exponer sp.iva_exento
 *
 * Default 0 = SÍ se calcula IVA (16%). 1 = exento (no se calcula).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
  try {
    await pool.query(
      `ALTER TABLE solicitudes_partidas
       ADD COLUMN IF NOT EXISTS iva_exento TINYINT(1) NOT NULL DEFAULT 0
       AFTER observaciones`
    );
    console.log('OK  solicitudes_partidas.iva_exento agregado');
  } catch (e) {
    console.log('INFO', e.message);
  }

  try {
    await pool.query(`
      CREATE OR REPLACE VIEW v_comparador_precios AS
      SELECT
        s.id                                   AS solicitud_id,
        s.folio                                AS folio_solicitud,
        sp.id                                  AS partida_id,
        sp.linea,
        sp.descripcion_original,
        sp.codigo_cliente,
        sp.cantidad,
        sp.unidad_medida,
        sp.observaciones,
        sp.iva_exento,
        p.nombre_empresa                       AS proveedor,
        cpp.sku_proveedor,
        cpp.observaciones_proveedor,
        cpp.precio_unitario,
        cpp.disponible,
        cpp.es_mejor_precio,
        (cpp.precio_unitario * sp.cantidad)    AS importe_compra
      FROM solicitudes s
      JOIN solicitudes_partidas sp
        ON sp.solicitud_id = s.id
      JOIN cotizaciones_proveedor cp
        ON cp.solicitud_id = s.id
      JOIN proveedores p
        ON p.id = cp.proveedor_id
      LEFT JOIN cotizaciones_proveedor_precios cpp
        ON  cpp.cotizacion_proveedor_id = cp.id
        AND cpp.partida_id = sp.id
      ORDER BY s.id, sp.linea, cpp.precio_unitario
    `);
    console.log('OK  v_comparador_precios actualizada (iva_exento + observaciones)');
  } catch (e) {
    console.log('INFO', e.message);
  }

  process.exit(0);
})();
