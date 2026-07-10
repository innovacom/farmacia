/**
 * Migración v8 — node migrate_v8.js
 *   · v_comparador_precios → exponer sp.producto_id, p.sku_interno y la
 *     descripción interna del catálogo.
 *
 * Objetivo: que el vínculo con el catálogo (producto_id) viaje desde la
 * solicitud hasta la cotización del cliente (y de ahí a pedido / OC / recepción).
 * Antes la vista no exponía estas columnas y el producto_id se perdía al crear
 * la cotización desde el comparador.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
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
        sp.producto_id,
        pr.sku_interno,
        pr.descripcion                         AS descripcion_interna,
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
      LEFT JOIN productos pr
        ON pr.id = sp.producto_id
      JOIN cotizaciones_proveedor cp
        ON cp.solicitud_id = s.id
      JOIN proveedores p
        ON p.id = cp.proveedor_id
      LEFT JOIN cotizaciones_proveedor_precios cpp
        ON  cpp.cotizacion_proveedor_id = cp.id
        AND cpp.partida_id = sp.id
      ORDER BY s.id, sp.linea, cpp.precio_unitario
    `);
    console.log('OK  v_comparador_precios actualizada (producto_id + sku_interno + descripcion_interna)');
  } catch (e) {
    console.log('INFO', e.message);
  }

  process.exit(0);
})();
