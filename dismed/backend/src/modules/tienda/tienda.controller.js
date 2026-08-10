/**
 * tienda.controller.js — Catálogo público de la farmacia (sin login, ver
 * memoria project_tienda_web_farmacia / plan de 4 entregas). Entrega 1: solo
 * lectura + botón "Pedir por WhatsApp" (deep link wa.me), que cae directo al
 * carrito conversacional que ya existe en whatsapp.carrito.service.js — este
 * módulo NO crea pedidos ni toca inventario.
 *
 * Solo expone productos con `publicar_web = 1` (bandera propia, distinta de
 * `vendible` que gobierna el mostrador/POS — un producto puede venderse en
 * mostrador sin listarse públicamente).
 *
 * Existencia: suma cruda de inventario_lotes sin distinguir almacén/sucursal
 * (suficiente para un "hay/no hay" público; mismo nivel de detalle que ve el
 * cliente por WhatsApp).
 */
const { pool } = require('../../config/db');

// Misma lista que whatsapp.carrito.service#CLASIF_LIBRES / pos.ventas.service —
// si el producto no está aquí, se muestra "requiere receta médica".
const CLASIF_LIBRES = ['libre', 'venta_farmacia'];

async function info(req, res, next) {
  try {
    res.json({
      nombre: process.env.EMPRESA_NOMBRE || 'Farmacia',
      whatsapp: process.env.TIENDA_WHATSAPP_NUMERO || null,
    });
  } catch (err) { next(err); }
}

async function categorias(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT f.id, f.nombre
       FROM productos p JOIN familias f ON f.id = p.familia_id
       WHERE p.activo = 1 AND p.publicar_web = 1
       ORDER BY f.nombre`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

function construirFiltro(query) {
  const where = ['p.activo = 1', 'p.publicar_web = 1'];
  const vals = [];
  if (query.q) {
    where.push('(p.descripcion LIKE ? OR p.descripcion_corta LIKE ?)');
    vals.push(`%${query.q}%`, `%${query.q}%`);
  }
  if (query.familia_id) { where.push('p.familia_id = ?'); vals.push(query.familia_id); }
  return { where, vals };
}

async function productosList(req, res, next) {
  try {
    const { where, vals } = construirFiltro(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 24, 60);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const [rows] = await pool.query(
      `SELECT p.id, p.descripcion, p.descripcion_corta, p.imagen_url, p.precio_publico,
              p.clasificacion_cofepris, p.fabricante, p.unidad_medida,
              f.nombre AS familia_nombre,
              COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id), 0) AS existencia
       FROM productos p
       LEFT JOIN familias f ON f.id = p.familia_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.descripcion
       LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM productos p WHERE ${where.join(' AND ')}`, vals
    );
    const decorados = rows.map((r) => ({
      ...r,
      requiere_receta: !CLASIF_LIBRES.includes(r.clasificacion_cofepris),
      disponible: Number(r.existencia) > 0,
    }));
    res.json({ rows: decorados, total });
  } catch (err) { next(err); }
}

async function productoDetalle(req, res, next) {
  try {
    const [[row]] = await pool.query(
      `SELECT p.id, p.descripcion, p.descripcion_corta, p.imagen_url, p.precio_publico,
              p.clasificacion_cofepris, p.fabricante, p.unidad_medida, p.ean,
              p.sustancia_activa, p.tamano, p.calibre, p.especificacion,
              f.nombre AS familia_nombre, c.nombre AS categoria_nombre,
              COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l WHERE l.producto_id = p.id), 0) AS existencia
       FROM productos p
       LEFT JOIN familias f        ON f.id = p.familia_id
       LEFT JOIN categorias_prod c ON c.id = p.categoria_id
       WHERE p.id = ? AND p.activo = 1 AND p.publicar_web = 1`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({
      ...row,
      requiere_receta: !CLASIF_LIBRES.includes(row.clasificacion_cofepris),
      disponible: Number(row.existencia) > 0,
    });
  } catch (err) { next(err); }
}

module.exports = { info, categorias, productosList, productoDetalle };
