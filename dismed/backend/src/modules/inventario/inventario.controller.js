const { pool } = require('../../config/db');
const fs = require('fs');
const XLSX = require('xlsx');
const svc = require('./movimientos.service');
const { parseExistencias } = require('./import.existencias');

// ── Existencias (vista) ───────────────────────────────────────────────────────
async function existencias(req, res, next) {
  try {
    const where = ['cantidad_actual > 0'];
    const vals = [];
    if (req.query.almacen_id)   { where.push('almacen_id = ?');   vals.push(req.query.almacen_id); }
    if (req.query.producto_id)  { where.push('producto_id = ?');  vals.push(req.query.producto_id); }
    if (req.query.q)            { where.push('(sku_interno LIKE ? OR descripcion LIKE ?)'); vals.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    if (req.query.estado)       { where.push('estado_caducidad = ?'); vals.push(req.query.estado); }
    const [rows] = await pool.query(
      `SELECT * FROM v_existencias WHERE ${where.join(' AND ')}
       ORDER BY descripcion, fecha_caducidad IS NULL, fecha_caducidad LIMIT 500`, vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function stockProducto(req, res, next) {
  try {
    const where = ['stock_total > 0'];
    const vals = [];
    if (req.query.q) { where.push('(sku_interno LIKE ? OR descripcion LIKE ?)'); vals.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const [rows] = await pool.query(
      `SELECT * FROM v_stock_producto WHERE ${where.join(' AND ')} ORDER BY descripcion LIMIT 500`, vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function alertas(req, res, next) {
  try {
    const [caducidad] = await pool.query(
      `SELECT * FROM v_existencias
       WHERE estado_caducidad IN ('CADUCADO','ALERTA_30','ALERTA_60','ALERTA_90')
       ORDER BY dias_caducidad LIMIT 200`
    );
    const [stockBajo] = await pool.query(
      `SELECT * FROM v_stock_producto WHERE stock_bajo = 1 AND stock_total > 0 ORDER BY descripcion LIMIT 200`
    );
    const [[tot]] = await pool.query('SELECT COALESCE(SUM(cantidad_actual*costo_unitario),0) AS valor_inventario FROM inventario_lotes');
    res.json({ caducidad, stock_bajo: stockBajo, valor_inventario: tot.valor_inventario });
  } catch (err) { next(err); }
}

// Lotes disponibles de un producto, ordenados FEFO (caduca primero → primero; sin caducidad al final)
async function lotesProducto(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM v_existencias WHERE producto_id = ? AND cantidad_actual > 0
       ORDER BY fecha_caducidad IS NULL, fecha_caducidad ASC`, [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function kardex(req, res, next) {
  try {
    const where = [];
    const vals = [];
    if (req.query.producto_id) { where.push('m.producto_id = ?'); vals.push(req.query.producto_id); }
    if (req.query.tipo)        { where.push('m.tipo = ?');        vals.push(req.query.tipo); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT m.*, p.sku_interno, p.descripcion,
              uo.codigo AS ubic_origen, ud.codigo AS ubic_destino, us.nombre AS usuario
       FROM inventario_movimientos m
       JOIN productos p        ON p.id = m.producto_id
       LEFT JOIN ubicaciones uo ON uo.id = m.ubicacion_origen_id
       LEFT JOIN ubicaciones ud ON ud.id = m.ubicacion_destino_id
       LEFT JOIN usuarios us    ON us.id = m.usuario_id
       ${wsql}
       ORDER BY m.created_at DESC, m.id DESC LIMIT 300`, vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

// ── Acciones (envuelven el servicio en una transacción) ───────────────────────
function accion(fn) {
  return async (req, res, next) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn, { ...req.body, usuario_id: req.user?.id || null });
      await conn.commit();
      res.json({ ok: true, ...out });
    } catch (err) {
      await conn.rollback();
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    } finally {
      conn.release();
    }
  };
}

const entrada  = accion(svc.registrarEntrada);
const salida   = accion(svc.registrarSalida);
const traspaso = accion(svc.registrarTraspaso);
const ajuste   = accion(svc.registrarAjuste);

// ── Importación de existencias (preview) ──────────────────────────────────────
async function importPreview(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const result = parseExistencias(req.file.path);
    // Cruzar SKU con catálogo
    const skus = [...new Set(result.renglones.map((r) => r.sku_interno))];
    let mapa = {};
    if (skus.length) {
      const [prods] = await pool.query(
        'SELECT id, sku_interno, control_lote_caducidad FROM productos WHERE sku_interno IN (?)', [skus]
      );
      prods.forEach((p) => { mapa[p.sku_interno] = p; });
    }
    result.renglones.forEach((r) => {
      const p = mapa[r.sku_interno];
      r._producto_id = p ? p.id : null;
      r._en_catalogo = !!p;
      r._control = p ? !!p.control_lote_caducidad : null;
      r._ok = !!p && r.cantidad > 0;
    });
    result.resumen.sin_catalogo = result.renglones.filter((r) => !r._en_catalogo).length;
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    res.json(result);
  } catch (err) { next(err); }
}

// ── Importación de existencias (confirmar) ────────────────────────────────────
async function importConfirm(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { almacen_id, renglones } = req.body;
    if (!almacen_id) return res.status(400).json({ error: 'almacen_id requerido' });
    if (!Array.isArray(renglones) || !renglones.length) return res.status(400).json({ error: 'renglones[] requerido' });
    await conn.beginTransaction();

    // cache de ubicaciones por código dentro del almacén
    const ubicCache = {};
    async function ubicacionId(codigo) {
      const cod = (codigo || 'SIN UBICACION').toString().trim().substring(0, 40);
      if (ubicCache[cod]) return ubicCache[cod];
      const [[u]] = await conn.query('SELECT id FROM ubicaciones WHERE almacen_id = ? AND codigo = ?', [almacen_id, cod]);
      if (u) { ubicCache[cod] = u.id; return u.id; }
      const tipo = /anaquel/i.test(cod) ? 'anaquel' : (/^\d+$/.test(cod) ? 'tarima' : 'otro');
      const [r] = await conn.query('INSERT INTO ubicaciones (almacen_id, codigo, tipo) VALUES (?, ?, ?)', [almacen_id, cod, tipo]);
      ubicCache[cod] = r.insertId;
      return r.insertId;
    }

    let importados = 0, omitidos = 0;
    const errores = [];
    for (const r of renglones) {
      const [[prod]] = await conn.query('SELECT id FROM productos WHERE sku_interno = ?', [r.sku_interno]);
      if (!prod || !(parseFloat(r.cantidad) > 0)) { omitidos++; continue; }
      const ubId = await ubicacionId(r.ubicacion);
      try {
        await svc.registrarEntrada(conn, {
          producto_id: prod.id, almacen_id, ubicacion_id: ubId,
          cantidad: r.cantidad, costo_unitario: r.costo_unitario || 0,
          numero_lote: r.numero_lote, fecha_caducidad: r.fecha_caducidad,
          motivo: 'Carga inicial de inventario', referencia: 'IMPORT',
          usuario_id: req.user?.id || null, permitir_sin_lote: true,
        });
        importados++;
      } catch (e) {
        omitidos++;
        if (errores.length < 20) errores.push({ sku: r.sku_interno, motivo: e.message });
      }
    }
    await conn.commit();
    res.json({ ok: true, importados, omitidos, errores });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/** GET /inventario/import-existencias/plantilla → xlsx de ejemplo con el layout que espera el import. */
function plantillaExistencias(req, res, next) {
  try {
    const headers = ['SKU', 'DESCRIPCION', 'PRECIO', 'LOTE', 'CADUCIDAD', 'INVENTARIO', 'TARIMA'];
    const ejemplos = [
      ['INAP00238', 'CANULA NASAL ADULTO', 12.50, 'L24-0518', '2027-05-31', 150, 'TARIMA 01'],
      ['DM-00042', 'GASA ESTERIL 10X10', 85.00, 0, '', 40, 'TARIMA 02'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ejemplos]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EXISTENCIAS');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_existencias.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
}

module.exports = {
  existencias, stockProducto, alertas, lotesProducto, kardex,
  entrada, salida, traspaso, ajuste,
  importPreview, importConfirm, plantillaExistencias,
};
