/**
 * consultas.controller.js — Consultas históricas (solo lectura) sobre el flujo:
 * solicitudes, cotizaciones, órdenes de compra y pedidos.
 *
 * Dos niveles de búsqueda (cascada):
 *   - ENCABEZADO: lista de documentos (folio, fecha, cliente/proveedor, totales).
 *   - DETALLE:    lista de renglones (partidas) que cumplen el criterio, cada uno
 *                 con su documento padre (doc_id, folio, fecha, cliente/proveedor).
 *
 * Filtros comunes (query string):
 *   q            texto libre (encabezado: cliente/proveedor/folio/concepto + descripción de
 *                partidas; detalle: descripción + códigos + sku de la partida)
 *   codigo       código del cliente / gobierno / proveedor en las partidas (solo encabezado)
 *   sku          sku_interno (DM-#####) en las partidas (solo encabezado)
 *   fecha_desde  YYYY-MM-DD (inclusive)
 *   fecha_hasta  YYYY-MM-DD (inclusive)
 *   limit/offset paginación (limit máx 200, default 50)
 */
const { pool } = require('../../config/db');

const like = (v) => `%${String(v).trim()}%`;
const paging = (req) => ({
  limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50)),
  offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
});

// ORDER BY seguro: `sort` solo se acepta si está en la lista blanca (sortCols);
// `dir` solo asc/desc. Si no, usa el orden por defecto. Siempre desempata por `tie`.
function orderBy(req, sortCols, defaultExpr, tie) {
  const key = req.query.sort;
  const col = key && sortCols && Object.prototype.hasOwnProperty.call(sortCols, key) ? sortCols[key] : null;
  const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const primary = col ? `${col} ${dir}` : defaultExpr;
  return tie ? `${primary}, ${tie}` : primary;
}

// Construye WHERE + params a partir de los filtros y una config por tipo (nivel ENCABEZADO).
function buildWhere(req, cfg) {
  const { q, codigo, sku, fecha_desde, fecha_hasta } = req.query;
  const where = [];
  const params = [];

  if (q && q.trim()) {
    const cols = cfg.textCols.map((c) => `${c} LIKE ?`);
    cols.push(`EXISTS (SELECT 1 FROM ${cfg.partidaTable} px WHERE px.${cfg.partidaFk} = ${cfg.alias}.id AND px.${cfg.partidaDesc} LIKE ?)`);
    where.push(`(${cols.join(' OR ')})`);
    cfg.textCols.forEach(() => params.push(like(q)));
    params.push(like(q));
  }
  if (codigo && codigo.trim() && cfg.codigoCols.length) {
    const sub = cfg.codigoCols.map((c) => `px.${c} LIKE ?`).join(' OR ');
    where.push(`EXISTS (SELECT 1 FROM ${cfg.partidaTable} px WHERE px.${cfg.partidaFk} = ${cfg.alias}.id AND (${sub}))`);
    cfg.codigoCols.forEach(() => params.push(like(codigo)));
  }
  if (sku && sku.trim()) {
    where.push(cfg.skuExists);
    params.push(like(sku));
  }
  if (fecha_desde) { where.push(`${cfg.dateCol} >= ?`); params.push(fecha_desde); }
  if (fecha_hasta) { where.push(`${cfg.dateCol} < ? + INTERVAL 1 DAY`); params.push(fecha_hasta); }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function runList(req, res, next, cfg) {
  try {
    const { limit, offset } = paging(req);
    const { sql: W, params } = buildWhere(req, cfg);
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total ${cfg.from} ${W}`, params
    );
    const order = orderBy(req, cfg.sortCols, `${cfg.dateCol} DESC`, `${cfg.alias}.id DESC`);
    const [rows] = await pool.query(
      `SELECT ${cfg.select} ${cfg.from} ${W} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, rows, limit, offset });
  } catch (err) { next(err); }
}

// Búsqueda a nivel DETALLE: devuelve renglones (partidas) + datos del documento padre.
function buildWhereDet(req, cfg) {
  const { q, fecha_desde, fecha_hasta } = req.query;
  const where = [];
  const params = [];

  if (q && q.trim()) {
    const cols = cfg.searchCols.map((c) => `${c} LIKE ?`);
    where.push(`(${cols.join(' OR ')})`);
    cfg.searchCols.forEach(() => params.push(like(q)));
  }
  if (fecha_desde) { where.push(`${cfg.dateCol} >= ?`); params.push(fecha_desde); }
  if (fecha_hasta) { where.push(`${cfg.dateCol} < ? + INTERVAL 1 DAY`); params.push(fecha_hasta); }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function runPartidaSearch(req, res, next, cfg) {
  try {
    const { limit, offset } = paging(req);
    const { sql: W, params } = buildWhereDet(req, cfg);
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total ${cfg.from} ${W}`, params
    );
    const order = orderBy(req, cfg.sortCols, `${cfg.dateCol} DESC`, cfg.orderTail);
    const [rows] = await pool.query(
      `SELECT ${cfg.select} ${cfg.from} ${W} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, rows, limit, offset });
  } catch (err) { next(err); }
}

// ---- Configs ENCABEZADO --------------------------------------------------
const CFG = {
  solicitudes: {
    alias: 's',
    from: `FROM solicitudes s JOIN clientes cl ON cl.id = s.cliente_id`,
    textCols: ['cl.razon_social', 's.folio', 's.concepto', 's.referencia_cliente', 's.atencion'],
    partidaTable: 'solicitudes_partidas', partidaFk: 'solicitud_id', partidaDesc: 'descripcion_original',
    codigoCols: ['codigo_cliente', 'codigo_gobierno'],
    skuExists: `EXISTS (SELECT 1 FROM solicitudes_partidas px JOIN productos pr ON pr.id = px.producto_id WHERE px.solicitud_id = s.id AND pr.sku_interno LIKE ?)`,
    dateCol: 's.created_at',
    sortCols: { folio: 's.folio', cliente: 'cl.razon_social', solicitud_cliente: 's.referencia_cliente', concepto: 's.concepto', estatus: 's.estatus', fecha: 's.created_at' },
    select: `s.id, s.folio, s.created_at AS fecha, cl.razon_social AS cliente, s.concepto,
             s.referencia_cliente AS solicitud_cliente, s.estatus,
             (SELECT COUNT(*) FROM solicitudes_partidas sp WHERE sp.solicitud_id = s.id) AS partidas`,
  },
  cotizaciones: {
    alias: 'c',
    from: `FROM cotizaciones_cliente c JOIN clientes cl ON cl.id = c.cliente_id`,
    textCols: ['cl.razon_social', 'c.folio', 'c.concepto', 'c.atencion'],
    partidaTable: 'cotizaciones_cliente_partidas', partidaFk: 'cotizacion_id', partidaDesc: 'descripcion',
    codigoCols: ['codigo_cliente'],
    skuExists: `EXISTS (SELECT 1 FROM cotizaciones_cliente_partidas px WHERE px.cotizacion_id = c.id AND px.sku_interno LIKE ?)`,
    dateCol: 'c.created_at',
    sortCols: { folio: 'c.folio', cliente: 'cl.razon_social', concepto: 'c.concepto', total: 'c.total', estatus: 'c.estatus', fecha: 'c.created_at' },
    select: `c.id, c.folio, c.created_at AS fecha, cl.razon_social AS cliente, c.concepto,
             c.total, c.estatus,
             (SELECT COUNT(*) FROM cotizaciones_cliente_partidas cp WHERE cp.cotizacion_id = c.id) AS partidas`,
  },
  'ordenes-compra': {
    alias: 'o',
    from: `FROM ordenes_compra o JOIN proveedores pr ON pr.id = o.proveedor_id`,
    textCols: ['pr.nombre_empresa', 'o.folio'],
    partidaTable: 'ordenes_compra_partidas', partidaFk: 'oc_id', partidaDesc: 'descripcion',
    codigoCols: ['sku_proveedor'],
    skuExists: `EXISTS (SELECT 1 FROM ordenes_compra_partidas px WHERE px.oc_id = o.id AND px.sku_interno LIKE ?)`,
    dateCol: 'o.created_at',
    sortCols: { folio: 'o.folio', proveedor: 'pr.nombre_empresa', total: 'o.total', estatus: 'o.estatus', fecha: 'o.created_at' },
    select: `o.id, o.folio, o.created_at AS fecha, pr.nombre_empresa AS proveedor,
             o.total, o.estatus,
             (SELECT COUNT(*) FROM ordenes_compra_partidas op WHERE op.oc_id = o.id) AS partidas`,
  },
  pedidos: {
    alias: 'p',
    from: `FROM pedidos_cliente p JOIN clientes cl ON cl.id = p.cliente_id`,
    textCols: ['cl.razon_social', 'p.folio'],
    partidaTable: 'pedidos_cliente_partidas', partidaFk: 'pedido_id', partidaDesc: 'descripcion',
    codigoCols: ['codigo_cliente'],
    skuExists: `EXISTS (SELECT 1 FROM pedidos_cliente_partidas px WHERE px.pedido_id = p.id AND px.sku_interno LIKE ?)`,
    dateCol: 'p.created_at',
    sortCols: { folio: 'p.folio', cliente: 'cl.razon_social', estatus: 'p.estatus', fecha: 'p.created_at' },
    select: `p.id, p.folio, p.created_at AS fecha, cl.razon_social AS cliente, p.estatus,
             (SELECT COUNT(*) FROM pedidos_cliente_partidas pp WHERE pp.pedido_id = p.id) AS partidas`,
  },
};

// ---- Configs DETALLE (renglones) -----------------------------------------
const CFG_DET = {
  solicitudes: {
    from: `FROM solicitudes_partidas sp
           JOIN solicitudes s ON s.id = sp.solicitud_id
           JOIN clientes cl ON cl.id = s.cliente_id`,
    searchCols: ['sp.descripcion_original', 'sp.codigo_cliente', 'sp.codigo_gobierno'],
    dateCol: 's.created_at',
    orderTail: 'sp.solicitud_id DESC, sp.linea',
    sortCols: { folio: 's.folio', cliente: 'cl.razon_social', codigo: 'sp.codigo_cliente', descripcion: 'sp.descripcion_original', cantidad: 'sp.cantidad', unidad: 'sp.unidad_medida', fecha: 's.created_at' },
    select: `sp.id, sp.solicitud_id AS doc_id, s.folio, s.created_at AS fecha,
             cl.razon_social AS cliente, sp.linea, sp.codigo_cliente, sp.codigo_gobierno,
             sp.descripcion_original AS descripcion, sp.cantidad, sp.unidad_medida`,
  },
  cotizaciones: {
    from: `FROM cotizaciones_cliente_partidas cp
           JOIN cotizaciones_cliente c ON c.id = cp.cotizacion_id
           JOIN clientes cl ON cl.id = c.cliente_id`,
    searchCols: ['cp.descripcion', 'cp.codigo_cliente', 'cp.sku_interno'],
    dateCol: 'c.created_at',
    orderTail: 'cp.cotizacion_id DESC, cp.linea',
    sortCols: { folio: 'c.folio', cliente: 'cl.razon_social', sku: 'cp.sku_interno', descripcion: 'cp.descripcion', cantidad: 'cp.cantidad', precio_unitario_venta: 'cp.precio_unitario_venta', importe: 'cp.importe', fecha: 'c.created_at' },
    select: `cp.id, cp.cotizacion_id AS doc_id, c.folio, c.created_at AS fecha,
             cl.razon_social AS cliente, cp.linea, cp.sku_interno, cp.codigo_cliente,
             cp.descripcion, cp.cantidad, cp.unidad_medida, cp.precio_unitario_venta, cp.importe`,
  },
  'ordenes-compra': {
    from: `FROM ordenes_compra_partidas op
           JOIN ordenes_compra o ON o.id = op.oc_id
           JOIN proveedores pr ON pr.id = o.proveedor_id`,
    searchCols: ['op.descripcion', 'op.sku_proveedor', 'op.sku_interno'],
    dateCol: 'o.created_at',
    orderTail: 'op.oc_id DESC, op.id',
    sortCols: { folio: 'o.folio', proveedor: 'pr.nombre_empresa', sku: 'op.sku_proveedor', descripcion: 'op.descripcion', cantidad: 'op.cantidad', precio_compra: 'op.precio_compra', fecha: 'o.created_at' },
    select: `op.id, op.oc_id AS doc_id, o.folio, o.created_at AS fecha,
             pr.nombre_empresa AS proveedor, op.sku_interno, op.sku_proveedor,
             op.descripcion, op.cantidad, op.precio_compra`,
  },
  pedidos: {
    from: `FROM pedidos_cliente_partidas pp
           JOIN pedidos_cliente p ON p.id = pp.pedido_id
           JOIN clientes cl ON cl.id = p.cliente_id`,
    searchCols: ['pp.descripcion', 'pp.codigo_cliente', 'pp.sku_interno'],
    dateCol: 'p.created_at',
    orderTail: 'pp.pedido_id DESC, pp.id',
    sortCols: { folio: 'p.folio', cliente: 'cl.razon_social', sku: 'pp.sku_interno', descripcion: 'pp.descripcion', cantidad: 'pp.cantidad_asignada', precio_unitario_venta: 'pp.precio_unitario_venta', fecha: 'p.created_at' },
    select: `pp.id, pp.pedido_id AS doc_id, p.folio, p.created_at AS fecha,
             cl.razon_social AS cliente, pp.sku_interno, pp.codigo_cliente,
             pp.descripcion, pp.cantidad_asignada AS cantidad, pp.precio_unitario_venta`,
  },
};

// Listados ENCABEZADO
const listSolicitudes = (req, res, next) => runList(req, res, next, CFG.solicitudes);
const listCotizaciones = (req, res, next) => runList(req, res, next, CFG.cotizaciones);
const listOrdenesCompra = (req, res, next) => runList(req, res, next, CFG['ordenes-compra']);
const listPedidos = (req, res, next) => runList(req, res, next, CFG.pedidos);

// Búsquedas DETALLE (renglones)
const partidasSolicitudes = (req, res, next) => runPartidaSearch(req, res, next, CFG_DET.solicitudes);
const partidasCotizaciones = (req, res, next) => runPartidaSearch(req, res, next, CFG_DET.cotizaciones);
const partidasOrdenesCompra = (req, res, next) => runPartidaSearch(req, res, next, CFG_DET['ordenes-compra']);
const partidasPedidos = (req, res, next) => runPartidaSearch(req, res, next, CFG_DET.pedidos);

// ---- Detalle (header + partidas) para drill-down -------------------------
async function detalleSolicitud(req, res, next) {
  try {
    const [[h]] = await pool.query(
      `SELECT s.*, cl.razon_social AS cliente FROM solicitudes s
       JOIN clientes cl ON cl.id = s.cliente_id WHERE s.id = ?`, [req.params.id]
    );
    if (!h) return res.status(404).json({ error: 'No encontrada' });
    const [partidas] = await pool.query(
      `SELECT linea, codigo_cliente, codigo_gobierno, descripcion_original AS descripcion,
              cantidad, unidad_medida, observaciones
       FROM solicitudes_partidas WHERE solicitud_id = ? ORDER BY linea`, [req.params.id]
    );
    res.json({ ...h, partidas });
  } catch (err) { next(err); }
}

async function detalleCotizacion(req, res, next) {
  try {
    const [[h]] = await pool.query(
      `SELECT c.*, cl.razon_social AS cliente FROM cotizaciones_cliente c
       JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id = ?`, [req.params.id]
    );
    if (!h) return res.status(404).json({ error: 'No encontrada' });
    const [partidas] = await pool.query(
      `SELECT linea, sku_interno, codigo_cliente, descripcion, cantidad, unidad_medida,
              precio_compra, margen_pct, precio_unitario_venta, importe
       FROM cotizaciones_cliente_partidas WHERE cotizacion_id = ? ORDER BY linea`, [req.params.id]
    );
    const [proveedores] = await pool.query(
      `SELECT cpp.partida_id, pr.nombre_empresa AS proveedor, cpp.precio_unitario,
              cpp.observaciones_proveedor, cpp.es_mejor_precio
       FROM cotizaciones_proveedor cp
       JOIN proveedores pr ON pr.id = cp.proveedor_id
       JOIN cotizaciones_proveedor_precios cpp ON cpp.cotizacion_proveedor_id = cp.id
       WHERE cp.solicitud_id = ? ORDER BY cpp.partida_id, cpp.precio_unitario`, [h.solicitud_id]
    );
    res.json({ ...h, partidas, proveedores });
  } catch (err) { next(err); }
}

async function detalleOrdenCompra(req, res, next) {
  try {
    const [[h]] = await pool.query(
      `SELECT o.*, pr.nombre_empresa AS proveedor FROM ordenes_compra o
       JOIN proveedores pr ON pr.id = o.proveedor_id WHERE o.id = ?`, [req.params.id]
    );
    if (!h) return res.status(404).json({ error: 'No encontrada' });
    const [partidas] = await pool.query(
      `SELECT sku_interno, sku_proveedor, descripcion, cantidad, unidad_medida,
              precio_compra, cantidad_recibida
       FROM ordenes_compra_partidas WHERE oc_id = ? ORDER BY id`, [req.params.id]
    );
    res.json({ ...h, partidas });
  } catch (err) { next(err); }
}

async function detallePedido(req, res, next) {
  try {
    const [[h]] = await pool.query(
      `SELECT p.*, cl.razon_social AS cliente FROM pedidos_cliente p
       JOIN clientes cl ON cl.id = p.cliente_id WHERE p.id = ?`, [req.params.id]
    );
    if (!h) return res.status(404).json({ error: 'No encontrada' });
    const [partidas] = await pool.query(
      `SELECT sku_interno, codigo_cliente, descripcion, unidad_medida,
              cantidad_asignada, precio_unitario_venta, cantidad_recibida, cantidad_entregada
       FROM pedidos_cliente_partidas WHERE pedido_id = ? ORDER BY id`, [req.params.id]
    );
    res.json({ ...h, partidas });
  } catch (err) { next(err); }
}

module.exports = {
  listSolicitudes, listCotizaciones, listOrdenesCompra, listPedidos,
  partidasSolicitudes, partidasCotizaciones, partidasOrdenesCompra, partidasPedidos,
  detalleSolicitud, detalleCotizacion, detalleOrdenCompra, detallePedido,
};
