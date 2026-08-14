/**
 * nadro.pedido.service.js — Arma el pedido diario a Nadro a partir de lo
 * vendido en el POS. Reutiliza el mismo criterio que
 * pos.reportes.service#ventasDetalladoProducto (proveedor confirmado en
 * proveedores_catalogo), pero acotado al proveedor Nadro y a un solo día
 * (v.created_at del propio día en curso, todas las sucursales de la empresa).
 *
 * Un producto vendido hoy con proveedor confirmado Nadro pero sin EAN
 * capturado en `productos` no se puede mandar al portal (que solo acepta
 * EAN) — se reporta aparte en `excluidos` en vez de perderse en silencio.
 */
const { pool } = require('../../config/db');

const NOMBRE_PROVEEDOR = process.env.NADRO_PROVEEDOR_NOMBRE || 'Nadro';

async function pedidoDelDia(empresaId, fecha) {
  const [rows] = await pool.query(
    `SELECT p.id AS producto_id, p.sku_interno, p.ean, vp.descripcion, vp.cantidad
     FROM (
       SELECT pp.producto_id, MAX(pp.descripcion) AS descripcion,
              SUM(pp.piezas_equivalentes) AS cantidad
       FROM pos_ventas_partidas pp JOIN pos_ventas v ON v.id = pp.venta_id
       WHERE v.empresa_id = ? AND v.estatus = 'completada'
         AND v.created_at >= ? AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY pp.producto_id
     ) vp
     JOIN productos p ON p.id = vp.producto_id
     JOIN proveedores_catalogo pc ON pc.producto_id = p.id
       AND pc.match_estado = 'confirmado' AND pc.activo = 1
     JOIN proveedores pr ON pr.id = pc.proveedor_id AND pr.nombre_empresa LIKE ?
     GROUP BY p.id, p.sku_interno, p.ean, vp.descripcion, vp.cantidad
     ORDER BY vp.descripcion`,
    [empresaId, fecha, fecha, `%${NOMBRE_PROVEEDOR}%`]
  );

  const items = [];
  const excluidos = [];
  for (const r of rows) {
    const cantidad = Math.max(1, Math.round(Number(r.cantidad) || 0));
    const ean = (r.ean || '').trim();
    if (!ean) {
      excluidos.push({
        producto_id: r.producto_id, sku_interno: r.sku_interno,
        descripcion: r.descripcion, cantidad, motivo: 'Sin EAN capturado en productos',
      });
      continue;
    }
    items.push({ producto_id: r.producto_id, sku_interno: r.sku_interno, ean, descripcion: r.descripcion, cantidad });
  }
  return { items, excluidos };
}

module.exports = { pedidoDelDia };
