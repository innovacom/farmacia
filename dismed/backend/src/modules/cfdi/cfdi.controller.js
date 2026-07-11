/**
 * cfdi.controller.js — Consulta histórica (encabezado–detalle) del repositorio
 * fiscal CFDI + gestión de la descarga masiva del SAT.
 *
 * Consulta (mismo estilo que el módulo /consultas):
 *   GET /cfdi/:tipo                 ENCABEZADO (comprobantes)   tipo: emitidos|recibidos
 *   GET /cfdi/:tipo/conceptos       DETALLE (renglones)
 *   GET /cfdi/comprobante/:id       header + conceptos (drill-down)
 *
 * Descargas:
 *   GET  /cfdi/descargas            bitácora
 *   POST /cfdi/descargas            dispara una descarga (manual)
 *   POST /cfdi/descargas/:id/procesar    verifica/continúa una solicitud
 *   POST /cfdi/descargas/procesar-pendientes
 *   GET  /cfdi/fiel                 valida la e.firma configurada
 */
const { pool } = require('../../config/db');
const svc = require('./sat.descarga.service');
const client = require('./sat.client');

const like = (v) => `%${String(v).trim()}%`;
const paging = (req) => ({
  limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50)),
  offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
});
// 'emitidos' | 'recibidos' | 'emitido' | 'recibido' → 'emitido' | 'recibido'
const normTipo = (t) => (String(t || '').toLowerCase().startsWith('emit') ? 'emitido' : 'recibido');

// ORDER BY seguro (whitelist). `sort` debe estar en sortCols; `dir` solo asc/desc.
function orderBy(req, sortCols, defaultExpr, tie) {
  const key = req.query.sort;
  const col = key && Object.prototype.hasOwnProperty.call(sortCols, key) ? sortCols[key] : null;
  const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const primary = col ? `${col} ${dir}` : defaultExpr;
  return tie ? `${primary}, ${tie}` : primary;
}
const SORT_COMP = { uuid: 'c.uuid', folio: 'c.folio', tipo_comprobante: 'c.tipo_comprobante', emisor: 'c.nombre_emisor', receptor: 'c.nombre_receptor', total: 'c.total', estatus: 'c.estatus', fecha: 'c.fecha' };
const SORT_CONC = { folio: 'c.folio', emisor: 'c.nombre_emisor', receptor: 'c.nombre_receptor', no_identificacion: 'cc.no_identificacion', descripcion: 'cc.descripcion', cantidad: 'cc.cantidad', unidad: 'cc.unidad', valor_unitario: 'cc.valor_unitario', importe: 'cc.importe', fecha: 'c.fecha' };

// ---- ENCABEZADO ----------------------------------------------------------
async function listComprobantes(req, res, next) {
  try {
    const tipo = normTipo(req.params.tipo);
    const { q, fecha_desde, fecha_hasta, tipo_comprobante, estatus } = req.query;
    const { limit, offset } = paging(req);
    const where = ['c.tipo = ?'];
    const params = [tipo];

    if (q && q.trim()) {
      where.push(`(c.uuid LIKE ? OR c.serie LIKE ? OR c.folio LIKE ? OR c.rfc_emisor LIKE ?
                   OR c.nombre_emisor LIKE ? OR c.rfc_receptor LIKE ? OR c.nombre_receptor LIKE ?
                   OR EXISTS (SELECT 1 FROM cfdi_repositorio_conceptos px WHERE px.comprobante_id = c.id AND px.descripcion LIKE ?))`);
      for (let i = 0; i < 8; i++) params.push(like(q));
    }
    if (tipo_comprobante) { where.push('c.tipo_comprobante = ?'); params.push(tipo_comprobante); }
    if (estatus) { where.push('c.estatus = ?'); params.push(estatus); }
    if (fecha_desde) { where.push('c.fecha >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { where.push('c.fecha < ? + INTERVAL 1 DAY'); params.push(fecha_hasta); }

    const W = `WHERE ${where.join(' AND ')}`;
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM cfdi_repositorio c ${W}`, params);
    const [rows] = await pool.query(
      `SELECT c.id, c.uuid, c.tipo_comprobante, c.serie, c.folio, c.fecha,
              c.rfc_emisor, c.nombre_emisor, c.rfc_receptor, c.nombre_receptor,
              c.subtotal, c.total, c.moneda, c.estatus, c.cfdi_relacionados,
              (SELECT COUNT(*) FROM cfdi_repositorio_conceptos cc WHERE cc.comprobante_id = c.id) AS conceptos
       FROM cfdi_repositorio c ${W}
       ORDER BY ${orderBy(req, SORT_COMP, 'c.fecha DESC', 'c.id DESC')} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, rows, limit, offset });
  } catch (err) { next(err); }
}

// ---- DETALLE (conceptos) -------------------------------------------------
async function listConceptos(req, res, next) {
  try {
    const tipo = normTipo(req.params.tipo);
    const { q, fecha_desde, fecha_hasta } = req.query;
    const { limit, offset } = paging(req);
    const where = ['c.tipo = ?'];
    const params = [tipo];

    if (q && q.trim()) {
      where.push('(cc.descripcion LIKE ? OR cc.no_identificacion LIKE ? OR cc.clave_prod_serv LIKE ? OR cc.codigo_interno LIKE ?)');
      for (let i = 0; i < 4; i++) params.push(like(q));
    }
    if (fecha_desde) { where.push('c.fecha >= ?'); params.push(fecha_desde); }
    if (fecha_hasta) { where.push('c.fecha < ? + INTERVAL 1 DAY'); params.push(fecha_hasta); }

    const FROM = `FROM cfdi_repositorio_conceptos cc JOIN cfdi_repositorio c ON c.id = cc.comprobante_id`;
    const W = `WHERE ${where.join(' AND ')}`;
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${W}`, params);
    const [rows] = await pool.query(
      `SELECT cc.id, cc.comprobante_id AS doc_id, c.uuid, c.serie, c.folio, c.fecha,
              c.rfc_emisor, c.nombre_emisor, c.rfc_receptor, c.nombre_receptor, c.estatus,
              cc.linea, cc.clave_prod_serv, cc.no_identificacion, cc.codigo_interno,
              cc.descripcion, cc.cantidad, cc.clave_unidad, cc.unidad, cc.valor_unitario, cc.importe
       ${FROM} ${W}
       ORDER BY ${orderBy(req, SORT_CONC, 'c.fecha DESC', 'cc.comprobante_id DESC, cc.linea')} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, rows, limit, offset });
  } catch (err) { next(err); }
}

// ---- Drill-down (header + conceptos) -------------------------------------
async function detalleComprobante(req, res, next) {
  try {
    const [[h]] = await pool.query('SELECT * FROM cfdi_repositorio WHERE id = ?', [req.params.id]);
    if (!h) return res.status(404).json({ error: 'No encontrado' });
    const [conceptos] = await pool.query(
      `SELECT linea, clave_prod_serv, no_identificacion, codigo_interno, descripcion, cantidad,
              clave_unidad, unidad, valor_unitario, importe, descuento,
              base_iva, tasa_iva, importe_iva, importe_ieps, importe_isr
       FROM cfdi_repositorio_conceptos WHERE comprobante_id = ? ORDER BY linea`, [req.params.id]
    );
    res.json({ ...h, conceptos });
  } catch (err) { next(err); }
}

// ---- Descargas (bitácora + disparadores) ---------------------------------
async function listDescargas(req, res, next) {
  try {
    const { limit, offset } = paging(req);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM cfdi_descargas');
    const [rows] = await pool.query(
      `SELECT id, tipo, request_type, fecha_desde, fecha_hasta, sat_id_solicitud, estado, estado_codigo,
              num_cfdis, num_paquetes, num_importados, mensaje, origen, created_at, updated_at
       FROM cfdi_descargas ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]
    );
    res.json({ total, rows, limit, offset });
  } catch (err) { next(err); }
}

// Dispara una descarga manual. Body: { tipo:'emitido'|'recibido'|'ambos', anio, mes }
// (o bien { desde:'YYYY-MM-DD HH:mm:ss', hasta:'...' }).
async function crearDescarga(req, res, next) {
  try {
    const { tipo = 'ambos', anio, mes } = req.body;
    let { desde, hasta } = req.body;
    if (!desde || !hasta) {
      const y = parseInt(anio, 10), m = parseInt(mes, 10);
      if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'Indica anio y mes (o desde/hasta).' });
      ({ desde, hasta } = svc.periodoMes(y, m));
    } else {
      // Acepta 'YYYY-MM-DD' y completa la hora. El SAT rechaza fecha final futura.
      if (desde.length <= 10) desde += ' 00:00:00';
      if (hasta.length <= 10) hasta += ' 23:59:59';
    }
    if (new Date(desde) > new Date(hasta)) return res.status(400).json({ error: 'La fecha "desde" no puede ser mayor que "hasta".' });
    const tipos = tipo === 'ambos' ? ['emitido', 'recibido'] : [normTipo(tipo)];
    const usuarioId = req.user?.id || null;
    const jobs = [];
    for (const t of tipos) {
      const job = await svc.solicitarDescarga({ tipo: t, desde, hasta, origen: 'manual', usuarioId });
      jobs.push({ tipo: t, ...job });
      // Continuar en segundo plano (el SAT tarda); el frontend refresca la bitácora.
      if (job.estado === 'en_proceso') {
        setImmediate(() => svc.procesarConEspera(job.id).catch((e) => console.error('[cfdi] proceso bg:', e.message)));
      }
    }
    res.status(202).json({ ok: true, periodo: { desde, hasta }, jobs });
  } catch (err) { next(err); }
}

async function procesarDescarga(req, res, next) {
  try { res.json(await svc.procesarDescarga(req.params.id)); }
  catch (err) { next(err); }
}

async function procesarPendientes(req, res, next) {
  try { res.json({ procesadas: await svc.procesarPendientes() }); }
  catch (err) { next(err); }
}

// Elimina un registro de la bitácora de descargas (no toca los CFDI ya importados).
async function eliminarDescarga(req, res, next) {
  try {
    const [r] = await pool.query('DELETE FROM cfdi_descargas WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Descarga no encontrada' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function validarFiel(req, res, next) {
  try { res.json(await client.validarFiel()); }
  catch (err) { res.status(400).json({ valida: false, error: err.message }); }
}

// Reconcilia estatus (vigente/cancelado) por metadata del SAT, en segundo plano.
// Body: { tipo:'emitido'|'recibido'|'ambos', anio, mes } o { tipo, desde, hasta }.
async function reconciliarEstatus(req, res, next) {
  try {
    const { tipo = 'ambos', anio, mes } = req.body;
    let { desde, hasta } = req.body;
    if (!desde || !hasta) {
      const y = parseInt(anio, 10), m = parseInt(mes, 10);
      if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'Indica anio y mes (o desde/hasta).' });
      ({ desde, hasta } = svc.periodoMes(y, m));
    } else {
      if (desde.length <= 10) desde += ' 00:00:00';
      if (hasta.length <= 10) hasta += ' 23:59:59';
    }
    if (new Date(desde) > new Date(hasta)) return res.status(400).json({ error: 'La fecha "desde" no puede ser mayor que "hasta".' });
    const tipos = tipo === 'ambos' ? ['emitido', 'recibido'] : [normTipo(tipo)];
    const usuarioId = req.user?.id || null;
    const jobs = [];
    for (const t of tipos) {
      // Encola un job de metadata visible en la bitácora y reanudable por el cron.
      const job = await svc.crearJobReconciliacion({ tipo: t, desde, hasta, usuarioId });
      jobs.push({ tipo: t, ...job });
    }
    res.status(202).json({ ok: true, mensaje: 'Reconciliación de estatus iniciada (ver bitácora).', periodo: { desde, hasta }, jobs });
  } catch (err) { next(err); }
}

async function purgarRepositorio(req, res, next) {
  try { res.json(await svc.purgarRepositorio()); }
  catch (err) { next(err); }
}

async function descargaBatch(req, res, next) {
  try {
    const { desde_anio, desde_mes, hasta_anio, hasta_mes } = req.body;
    res.json(await svc.programarBatch({
      desdeAnio: desde_anio ? parseInt(desde_anio, 10) : 2019,
      desMes:    desde_mes  ? parseInt(desde_mes, 10)  : 3,
      hastaAnio: hasta_anio ? parseInt(hasta_anio, 10) : undefined,
      hastaMes:  hasta_mes  ? parseInt(hasta_mes, 10)  : undefined,
      usuarioId: req.user?.id || null,
    }));
  } catch (err) { next(err); }
}

module.exports = {
  listComprobantes, listConceptos, detalleComprobante,
  listDescargas, crearDescarga, procesarDescarga, procesarPendientes, validarFiel,
  reconciliarEstatus, eliminarDescarga,
  purgarRepositorio, descargaBatch,
};
