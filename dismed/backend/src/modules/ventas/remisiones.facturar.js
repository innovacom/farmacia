/**
 * remisiones.facturar.js — Consolidar 1..N remisiones del MISMO cliente (de cualquier pedido/sucursal)
 * en una sola factura. Las remisiones no se modifican (salvo marcar a qué factura pertenecen): la
 * factura es una entrega tipo 'factura' cuyas partidas son copia exacta de las de las remisiones.
 * No toca inventario (la salida ya ocurrió al emitir cada remisión).
 * El timbrado reutiliza los endpoints existentes /entregas/:id/cfdi/timbrar.
 */
const { pool } = require('../../config/db');
const { validarFactura, generarCfdiTxt } = require('./cfdi.txt.generator');
const { generarEntregaPdf } = require('./ventas.pdf');
const { cargarEntregaCfdi } = require('./cfdi.facturama');
const { urlFirmada } = require('../../services/outputUrl.service');

const IVA_TASA = 0.16;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function genFolio(conn, serie) {
  await conn.query('CALL sp_generar_folio(?, @f)', [serie]);
  const [[{ f }]] = await conn.query('SELECT @f AS f');
  return f;
}

// Mismo criterio de redondeo por concepto que el CFDI (importe e IVA por línea).
function totalesPartidas(partidas) {
  let subtotal = 0, iva = 0;
  for (const p of partidas) {
    const imp = r2(Number(p.cantidad) * Number(p.precio_unitario));
    subtotal += imp;
    iva += p.iva_exento ? 0 : r2(imp * IVA_TASA);
  }
  subtotal = r2(subtotal); iva = r2(iva);
  return { subtotal, iva, total: r2(subtotal + iva) };
}

function ids(body) {
  const arr = Array.isArray(body?.remision_ids) ? body.remision_ids : [];
  return [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Carga y valida las remisiones elegidas. Lanza Error con .status si algo no cuadra. */
async function cargarRemisiones(db, idList, { lock = false } = {}) {
  if (!idList.length) { const e = new Error('Selecciona al menos una remisión'); e.status = 400; throw e; }
  const [rems] = await db.query(
    `SELECT e.*, su.nombre AS sucursal, p.folio AS pedido_folio
       FROM entregas e
       LEFT JOIN clientes_sucursales su ON su.id = e.sucursal_id
       LEFT JOIN pedidos_cliente p ON p.id = e.pedido_id
      WHERE e.id IN (?) ${lock ? 'FOR UPDATE' : ''}`, [idList]);
  if (rems.length !== idList.length) { const e = new Error('Alguna remisión no existe'); e.status = 404; throw e; }
  for (const r of rems) {
    if (r.tipo !== 'remision') { const e = new Error(`${r.folio} no es una remisión`); e.status = 400; throw e; }
    if (r.factura_id) { const e = new Error(`${r.folio} ya fue facturada`); e.status = 409; throw e; }
  }
  if (new Set(rems.map((r) => r.cliente_id)).size > 1) {
    const e = new Error('Todas las remisiones deben ser del mismo cliente'); e.status = 400; throw e;
  }
  const [partidas] = await db.query(
    `SELECT ep.*, e.folio AS remision_folio, pr.clave_sat, pr.clave_unidad_sat
       FROM entregas_partidas ep
       JOIN entregas e ON e.id = ep.entrega_id
       LEFT JOIN productos pr ON pr.id = ep.producto_id
      WHERE ep.entrega_id IN (?) ORDER BY ep.entrega_id, ep.id`, [idList]);
  return { rems, partidas };
}

// GET /remisiones/pendientes?cliente_id=
async function pendientes(req, res, next) {
  try {
    const params = [];
    let where = "e.tipo = 'remision' AND e.factura_id IS NULL";
    if (req.query.cliente_id) { where += ' AND e.cliente_id = ?'; params.push(req.query.cliente_id); }
    const [rows] = await pool.query(
      `SELECT e.id, e.folio, e.cliente_id, c.razon_social AS cliente, e.sucursal_id, su.nombre AS sucursal,
              p.folio AS pedido_folio, e.subtotal, e.iva, e.total, e.created_at,
              (SELECT COUNT(*) FROM entregas_partidas ep WHERE ep.entrega_id = e.id) AS partidas
         FROM entregas e
         JOIN clientes c ON c.id = e.cliente_id
         LEFT JOIN clientes_sucursales su ON su.id = e.sucursal_id
         LEFT JOIN pedidos_cliente p ON p.id = e.pedido_id
        WHERE ${where} ORDER BY c.razon_social, e.created_at, e.id`, params);
    res.json(rows);
  } catch (err) { next(err); }
}

// POST /remisiones/consolidar/resumen {remision_ids, forma_pago?, metodo_pago?, uso_cfdi?}
async function resumen(req, res, next) {
  try {
    const { rems, partidas } = await cargarRemisiones(pool, ids(req.body));
    const [[cliente]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [rems[0].cliente_id]);
    const t = totalesPartidas(partidas);
    const sumaRemisiones = r2(rems.reduce((s, r) => s + Number(r.total), 0));
    const v = validarFactura({
      entrega: {
        tipo: 'factura', moneda: 'MXN',
        forma_pago: req.body.forma_pago || cliente.forma_pago,
        metodo_pago: req.body.metodo_pago || cliente.metodo_pago,
        uso_cfdi: req.body.uso_cfdi || cliente.uso_cfdi,
      },
      cliente, partidas,
    });
    res.json({
      cliente: { id: cliente.id, razon_social: cliente.razon_social, rfc: cliente.rfc, uso_cfdi: cliente.uso_cfdi, forma_pago: cliente.forma_pago, metodo_pago: cliente.metodo_pago },
      remisiones: rems.map((r) => ({ id: r.id, folio: r.folio, sucursal: r.sucursal, pedido_folio: r.pedido_folio, total: Number(r.total) })),
      partidas: partidas.map((p) => ({ remision_folio: p.remision_folio, sku_interno: p.sku_interno, descripcion: p.descripcion, cantidad: Number(p.cantidad), precio_unitario: Number(p.precio_unitario), iva_exento: !!p.iva_exento })),
      ...t, suma_remisiones: sumaRemisiones, diferencia_redondeo: r2(t.total - sumaRemisiones),
      faltantes: v.faltantes,
    });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
}

// POST /remisiones/consolidar {remision_ids, forma_pago, metodo_pago, uso_cfdi, moneda?, notas?}
async function consolidar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { forma_pago, metodo_pago, uso_cfdi, moneda, notas } = req.body;
    await conn.beginTransaction();
    const { rems, partidas } = await cargarRemisiones(conn, ids(req.body), { lock: true });
    const [[cliente]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [rems[0].cliente_id]);
    const header = { forma_pago: forma_pago || null, metodo_pago: metodo_pago || null, moneda: moneda || 'MXN', uso_cfdi: uso_cfdi || null };
    const v = validarFactura({ entrega: { tipo: 'factura', ...header }, cliente, partidas });
    if (!v.ok) {
      await conn.rollback();
      return res.status(422).json({ error: 'Faltan datos fiscales para emitir la factura (CFDI 4.0)', faltantes: v.faltantes });
    }
    const t = totalesPartidas(partidas);
    const sucursalId = new Set(rems.map((r) => r.sucursal_id || 0)).size === 1 ? (rems[0].sucursal_id || null) : null;
    const pedidoId = new Set(rems.map((r) => r.pedido_id)).size === 1 ? rems[0].pedido_id : null;
    const nota = [`Remisiones: ${rems.map((r) => r.folio).join(', ')}`, String(notas || '').trim().slice(0, 300)].filter(Boolean).join('\n');

    const folio = await genFolio(conn, 'FAC');
    const [r] = await conn.query(
      `INSERT INTO entregas (folio, tipo, pedido_id, cliente_id, sucursal_id, usuario_id, notas, forma_pago, metodo_pago, moneda, uso_cfdi, consolidada, subtotal, iva, total)
       VALUES (?, 'factura', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [folio, pedidoId, cliente.id, sucursalId, req.user?.id || null, nota,
       header.forma_pago, header.metodo_pago, header.moneda, header.uso_cfdi, t.subtotal, t.iva, t.total]);
    const facId = r.insertId;
    await conn.query(
      `INSERT INTO entregas_partidas (entrega_id, pedido_partida_id, producto_id, sku_interno, descripcion, unidad_medida, cantidad, precio_unitario, iva_exento)
       SELECT ?, pedido_partida_id, producto_id, sku_interno, descripcion, unidad_medida, cantidad, precio_unitario, iva_exento
         FROM entregas_partidas WHERE entrega_id IN (?) ORDER BY entrega_id, id`, [facId, rems.map((x) => x.id)]);
    await conn.query('UPDATE entregas SET factura_id = ? WHERE id IN (?)', [facId, rems.map((x) => x.id)]);
    await conn.commit();

    let cfdi_txt = null, url = null;
    try { cfdi_txt = urlFirmada((await generarCfdiTxt(facId)).relativePath); } catch (e) { /* regenerable */ }
    try {
      const full = await cargarEntregaCfdi(facId);
      const { relativePath } = await generarEntregaPdf(full);
      await pool.query('UPDATE entregas SET pdf_path = ? WHERE id = ?', [relativePath, facId]);
      url = urlFirmada(relativePath);
    } catch (e) { /* regenerable */ }
    res.status(201).json({ id: facId, folio, ...t, url, cfdi_txt });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally { conn.release(); }
}

// GET /remisiones/facturas — facturas consolidadas aún sin timbrar
async function facturasPendientes(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.folio, f.cliente_id, c.razon_social AS cliente, f.subtotal, f.iva, f.total, f.estatus_cfdi, f.created_at,
              (SELECT GROUP_CONCAT(r.folio ORDER BY r.id SEPARATOR ', ') FROM entregas r WHERE r.factura_id = f.id) AS remisiones
         FROM entregas f JOIN clientes c ON c.id = f.cliente_id
        WHERE f.consolidada = 1 AND (f.estatus_cfdi IS NULL OR f.estatus_cfdi NOT IN ('timbrado','cancelado'))
        ORDER BY f.id DESC`);
    res.json(rows);
  } catch (err) { next(err); }
}

// DELETE /remisiones/facturas/:id — descarta una factura consolidada NO timbrada y libera sus remisiones
async function descartar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[f]] = await conn.query('SELECT * FROM entregas WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!f || !f.consolidada) { await conn.rollback(); return res.status(404).json({ error: 'Factura consolidada no encontrada' }); }
    const [[vig]] = await conn.query("SELECT id FROM cfdi_comprobantes WHERE entrega_id = ? AND status = 'vigente' LIMIT 1", [f.id]);
    if (vig || f.estatus_cfdi === 'timbrado') { await conn.rollback(); return res.status(409).json({ error: 'La factura ya está timbrada; cancela el CFDI' }); }
    await conn.query('UPDATE entregas SET factura_id = NULL WHERE factura_id = ?', [f.id]);
    await conn.query('DELETE FROM entregas WHERE id = ?', [f.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
}

module.exports = { pendientes, resumen, consolidar, facturasPendientes, descartar };
