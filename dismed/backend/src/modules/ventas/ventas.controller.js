const { pool } = require('../../config/db');
const svc = require('../inventario/movimientos.service');
const { ejecutarRecepcion } = require('./recepcion.service');
const { generarOcPdf, generarEntregaPdf } = require('./ventas.pdf');
const { validarFactura, generarCfdiTxt } = require('./cfdi.txt.generator');
const { timbrarEntrega, cancelarCfdi: cancelarCfdiSvc } = require('./cfdi.facturama');

async function genFolio(conn, serie) {
  await conn.query('CALL sp_generar_folio(?, @f)', [serie]);
  const [[{ f }]] = await conn.query('SELECT @f AS f');
  return f;
}

// ── PEDIDO (asignación del cliente) ───────────────────────────────────────────
async function crearPedido(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { cotizacion_id, partidas, notas } = req.body;
    if (!cotizacion_id || !Array.isArray(partidas) || !partidas.length) {
      return res.status(400).json({ error: 'cotizacion_id y partidas[] requeridos' });
    }
    await conn.beginTransaction();
    const [[cot]] = await conn.query('SELECT id, cliente_id FROM cotizaciones_cliente WHERE id = ?', [cotizacion_id]);
    if (!cot) { await conn.rollback(); return res.status(404).json({ error: 'Cotización no encontrada' }); }

    const folio = await genFolio(conn, 'PED');
    const [r] = await conn.query(
      'INSERT INTO pedidos_cliente (folio, cotizacion_id, cliente_id, notas, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [folio, cotizacion_id, cot.cliente_id, notas || null, req.user?.id || null]
    );
    const pedidoId = r.insertId;

    for (const it of partidas) {
      const cant = parseFloat(it.cantidad_asignada);
      if (!(cant > 0)) continue;
      const [[ccp]] = await conn.query(
        'SELECT * FROM cotizaciones_cliente_partidas WHERE id = ? AND cotizacion_id = ?',
        [it.cotizacion_partida_id, cotizacion_id]
      );
      if (!ccp) continue;
      // Resolver proveedor con mejor precio (de la solicitud original)
      let proveedorId = null, precioCompra = ccp.precio_compra || 0;
      if (ccp.partida_solicitud_id) {
        const [[mp]] = await conn.query(
          `SELECT cp.proveedor_id, cpp.precio_unitario
           FROM cotizaciones_proveedor_precios cpp
           JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
           WHERE cpp.partida_id = ? AND cpp.es_mejor_precio = 1 AND cpp.disponible = 1
           LIMIT 1`, [ccp.partida_solicitud_id]
        );
        if (mp) { proveedorId = mp.proveedor_id; precioCompra = mp.precio_unitario; }
      }
      await conn.query(
        `INSERT INTO pedidos_cliente_partidas
           (pedido_id, cotizacion_partida_id, producto_id, sku_interno, codigo_cliente, descripcion,
            unidad_medida, cantidad_asignada, precio_unitario_venta, iva_exento, proveedor_id, precio_compra)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pedidoId, ccp.id, ccp.producto_id, ccp.sku_interno, ccp.codigo_cliente, ccp.descripcion,
         ccp.unidad_medida, cant, ccp.precio_unitario_venta, ccp.iva_exento ? 1 : 0, proveedorId, precioCompra]
      );
    }
    await conn.query("UPDATE cotizaciones_cliente SET estatus = 'aceptada' WHERE id = ? AND estatus <> 'aceptada'", [cotizacion_id]);
    await conn.commit();
    res.status(201).json({ id: pedidoId, folio });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
}

async function listPedidos(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.folio, p.estatus, p.created_at, c.razon_social AS cliente,
              cot.folio AS cotizacion_folio,
              (SELECT COUNT(*) FROM pedidos_cliente_partidas pp WHERE pp.pedido_id = p.id) AS partidas
       FROM pedidos_cliente p
       JOIN clientes c ON c.id = p.cliente_id
       JOIN cotizaciones_cliente cot ON cot.id = p.cotizacion_id
       ORDER BY p.id DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getPedido(req, res, next) {
  try {
    const [[ped]] = await pool.query(
      `SELECT p.*, c.razon_social AS cliente, cot.folio AS cotizacion_folio
       FROM pedidos_cliente p JOIN clientes c ON c.id = p.cliente_id
       JOIN cotizaciones_cliente cot ON cot.id = p.cotizacion_id WHERE p.id = ?`, [req.params.id]
    );
    if (!ped) return res.status(404).json({ error: 'Pedido no encontrado' });
    const [partidas] = await pool.query(
      `SELECT pp.*, pr.nombre_empresa AS proveedor,
              COALESCE((SELECT SUM(cantidad_actual) FROM inventario_lotes il WHERE il.producto_id = pp.producto_id), 0) AS stock
       FROM pedidos_cliente_partidas pp
       LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
       WHERE pp.pedido_id = ? ORDER BY pp.id`, [req.params.id]
    );
    const [ocs] = await pool.query(
      `SELECT oc.*, pr.nombre_empresa AS proveedor FROM ordenes_compra oc
       JOIN proveedores pr ON pr.id = oc.proveedor_id WHERE oc.pedido_id = ? ORDER BY oc.id`, [req.params.id]
    );
    const [entregas] = await pool.query(
      'SELECT id, folio, tipo, total, pdf_path, cfdi_txt_path, estatus_cfdi, created_at FROM entregas WHERE pedido_id = ? ORDER BY id DESC', [req.params.id]
    );
    res.json({ ...ped, partidas, ordenes_compra: ocs, entregas });
  } catch (err) { next(err); }
}

// ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────────────
async function generarOC(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ped]] = await conn.query('SELECT * FROM pedidos_cliente WHERE id = ?', [req.params.id]);
    if (!ped) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    const [partidas] = await conn.query('SELECT * FROM pedidos_cliente_partidas WHERE pedido_id = ?', [req.params.id]);
    // Cantidad ya ordenada por partida
    const [yaOrd] = await conn.query(
      `SELECT ocp.pedido_partida_id, SUM(ocp.cantidad) ordenada
       FROM ordenes_compra_partidas ocp JOIN ordenes_compra oc ON oc.id = ocp.oc_id
       WHERE oc.pedido_id = ? AND oc.estatus <> 'cancelada' GROUP BY ocp.pedido_partida_id`, [req.params.id]
    );
    const ordMap = {}; yaOrd.forEach((x) => { ordMap[x.pedido_partida_id] = Number(x.ordenada); });

    // Agrupar pendientes por proveedor
    const porProv = {};
    for (const pp of partidas) {
      if (!pp.proveedor_id) continue;
      const pend = Number(pp.cantidad_asignada) - (ordMap[pp.id] || 0);
      if (pend <= 0) continue;
      (porProv[pp.proveedor_id] = porProv[pp.proveedor_id] || []).push({ pp, pend });
    }
    if (!Object.keys(porProv).length) { await conn.rollback(); return res.status(400).json({ error: 'No hay partidas pendientes con proveedor para generar OC' }); }

    const creadas = [];
    for (const [provId, items] of Object.entries(porProv)) {
      const folio = await genFolio(conn, 'OC');
      let total = 0;
      const [r] = await conn.query(
        'INSERT INTO ordenes_compra (folio, pedido_id, proveedor_id, usuario_id) VALUES (?, ?, ?, ?)',
        [folio, req.params.id, provId, req.user?.id || null]
      );
      const ocId = r.insertId;
      for (const { pp, pend } of items) {
        total += Number(pp.precio_compra) * pend;
        // Código que el proveedor reconoce, si ya lo aprendimos (proveedores_skus)
        let skuProv = null;
        if (pp.producto_id) {
          const [[ps]] = await conn.query(
            `SELECT sku_proveedor FROM proveedores_skus
             WHERE proveedor_id = ? AND producto_id = ?
             ORDER BY ultima_cotizacion DESC LIMIT 1`,
            [provId, pp.producto_id]
          );
          if (ps) skuProv = ps.sku_proveedor;
        }
        await conn.query(
          `INSERT INTO ordenes_compra_partidas (oc_id, pedido_partida_id, producto_id, sku_interno, sku_proveedor, descripcion, unidad_medida, cantidad, precio_compra)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [ocId, pp.id, pp.producto_id, pp.sku_interno, skuProv, pp.descripcion, pp.unidad_medida, pend, pp.precio_compra]
        );
      }
      await conn.query('UPDATE ordenes_compra SET total = ? WHERE id = ?', [total, ocId]);
      creadas.push(ocId);
    }
    await conn.commit();

    // PDFs (fuera de la transacción)
    for (const ocId of creadas) {
      try {
        const oc = await cargarOC(ocId);
        const { relativePath } = await generarOcPdf(oc);
        await pool.query('UPDATE ordenes_compra SET pdf_path = ? WHERE id = ?', [relativePath, ocId]);
      } catch (e) { /* el PDF se puede regenerar luego */ }
    }
    res.status(201).json({ ok: true, ordenes: creadas.length });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
}

async function cargarOC(id) {
  const [[oc]] = await pool.query(
    `SELECT oc.*, pr.nombre_empresa AS proveedor_nombre, p.folio AS pedido_folio
     FROM ordenes_compra oc JOIN proveedores pr ON pr.id = oc.proveedor_id
     JOIN pedidos_cliente p ON p.id = oc.pedido_id WHERE oc.id = ?`, [id]
  );
  if (!oc) return null;
  const [partidas] = await pool.query('SELECT * FROM ordenes_compra_partidas WHERE oc_id = ? ORDER BY id', [id]);
  return { ...oc, partidas };
}

async function getOC(req, res, next) {
  try {
    const oc = await cargarOC(req.params.id);
    if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
    res.json(oc);
  } catch (err) { next(err); }
}

async function ocPdf(req, res, next) {
  try {
    const [[oc]] = await pool.query('SELECT pdf_path FROM ordenes_compra WHERE id = ?', [req.params.id]);
    if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
    if (oc.pdf_path) return res.json({ url: oc.pdf_path });
    const full = await cargarOC(req.params.id);
    const { relativePath } = await generarOcPdf(full);
    await pool.query('UPDATE ordenes_compra SET pdf_path = ? WHERE id = ?', [relativePath, req.params.id]);
    res.json({ url: relativePath });
  } catch (err) { next(err); }
}

// ── RECEPCIÓN (parcial) → afecta inventario ───────────────────────────────────
async function recepcion(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { almacen_id, partidas } = req.body;
    await conn.beginTransaction();
    const { folio, estatus_oc } = await ejecutarRecepcion(conn, {
      oc_id: req.params.id, almacen_id, partidas, usuario_id: req.user?.id || null,
    });
    await conn.commit();
    res.status(201).json({ ok: true, folio, estatus_oc });
  } catch (err) { await conn.rollback(); if (err.status) return res.status(err.status).json({ error: err.message }); next(err); } finally { conn.release(); }
}

// ── ENTREGA al cliente (remisión/factura) → salida FEFO de inventario ──────────
async function crearEntrega(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { tipo, partidas, notas, forma_pago, metodo_pago, moneda, uso_cfdi } = req.body;
    const tipoFinal = tipo === 'factura' ? 'factura' : 'remision';
    if (!Array.isArray(partidas) || !partidas.length) return res.status(400).json({ error: 'partidas[] requeridas' });
    await conn.beginTransaction();
    const [[ped]] = await conn.query('SELECT * FROM pedidos_cliente WHERE id = ?', [req.params.id]);
    if (!ped) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    // Datos del comprobante (solo aplican a factura)
    const cfdiHeader = tipoFinal === 'factura'
      ? { forma_pago: forma_pago || null, metodo_pago: metodo_pago || null, moneda: moneda || 'MXN', uso_cfdi: uso_cfdi || null }
      : { forma_pago: null, metodo_pago: null, moneda: 'MXN', uso_cfdi: null };

    const folio = await genFolio(conn, tipoFinal === 'factura' ? 'FAC' : 'REM');
    const [r] = await conn.query(
      `INSERT INTO entregas (folio, tipo, pedido_id, cliente_id, usuario_id, notas, forma_pago, metodo_pago, moneda, uso_cfdi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, tipoFinal, ped.id, ped.cliente_id, req.user?.id || null, notas || null,
       cfdiHeader.forma_pago, cfdiHeader.metodo_pago, cfdiHeader.moneda, cfdiHeader.uso_cfdi]
    );
    const entId = r.insertId;
    let subtotal = 0, iva = 0;
    const partidasFactura = []; // para validar CFDI antes de confirmar

    for (const it of partidas) {
      const cant = parseFloat(it.cantidad);
      if (!(cant > 0)) continue;
      const [[pp]] = await conn.query('SELECT * FROM pedidos_cliente_partidas WHERE id = ? AND pedido_id = ?', [it.pedido_partida_id, ped.id]);
      if (!pp) continue;
      const pendiente = Number(pp.cantidad_recibida) - Number(pp.cantidad_entregada);
      if (cant > pendiente + 0.0001) { await conn.rollback(); return res.status(400).json({ error: `${pp.sku_interno}: solo hay ${pendiente} recibidas pendientes de entregar` }); }
      if (!pp.producto_id) { await conn.rollback(); return res.status(400).json({ error: `${pp.descripcion} no tiene producto de catálogo` }); }

      // Salida FEFO (valida stock disponible; no permite negativo)
      await svc.registrarSalidaFEFO(conn, {
        producto_id: pp.producto_id, cantidad: cant,
        motivo: `Entrega ${folio} (${tipoFinal})`, referencia: folio, usuario_id: req.user?.id || null,
      });
      await conn.query(
        `INSERT INTO entregas_partidas (entrega_id, pedido_partida_id, producto_id, sku_interno, descripcion, unidad_medida, cantidad, precio_unitario, iva_exento)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [entId, pp.id, pp.producto_id, pp.sku_interno, pp.descripcion, pp.unidad_medida, cant, pp.precio_unitario_venta, pp.iva_exento ? 1 : 0]
      );
      await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_entregada = cantidad_entregada + ? WHERE id = ?', [cant, pp.id]);
      const imp = Number(pp.precio_unitario_venta) * cant;
      subtotal += imp; iva += pp.iva_exento ? 0 : imp * 0.16;

      if (tipoFinal === 'factura') {
        const [[prod]] = await conn.query('SELECT clave_sat, clave_unidad_sat FROM productos WHERE id = ?', [pp.producto_id]);
        partidasFactura.push({
          id: pp.id, sku_interno: pp.sku_interno, descripcion: pp.descripcion, iva_exento: pp.iva_exento,
          clave_sat: prod?.clave_sat || null, clave_unidad_sat: prod?.clave_unidad_sat || null,
        });
      }
    }

    // Validación CFDI 4.0 ANTES de confirmar: si faltan datos, no se crea la factura.
    if (tipoFinal === 'factura') {
      const [[cliente]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [ped.cliente_id]);
      const v = validarFactura({ entrega: { tipo: 'factura', ...cfdiHeader }, cliente, partidas: partidasFactura });
      if (!v.ok) {
        await conn.rollback();
        return res.status(422).json({ error: 'Faltan datos fiscales para emitir la factura (CFDI 4.0)', faltantes: v.faltantes });
      }
    }

    const total = subtotal + iva;
    await conn.query('UPDATE entregas SET subtotal = ?, iva = ?, total = ? WHERE id = ?', [subtotal.toFixed(2), iva.toFixed(2), total.toFixed(2), entId]);
    await conn.commit();

    // PDF
    let url = null;
    try {
      const full = await cargarEntrega(entId);
      const { relativePath } = await generarEntregaPdf(full);
      await pool.query('UPDATE entregas SET pdf_path = ? WHERE id = ?', [relativePath, entId]);
      url = relativePath;
    } catch (e) { /* regenerable */ }

    // TXT CFDI (factura): la validación ya pasó, así que esto no debería fallar.
    let cfdi_txt = null;
    if (tipoFinal === 'factura') {
      try { cfdi_txt = (await generarCfdiTxt(entId)).relativePath; } catch (e) { /* regenerable vía endpoint */ }
    }
    res.status(201).json({ id: entId, folio, tipo: tipoFinal, url, cfdi_txt });
  } catch (err) { await conn.rollback(); if (err.status) return res.status(err.status).json({ error: err.message }); next(err); } finally { conn.release(); }
}

// ── TXT CFDI (regenerar / descargar) ──────────────────────────────────────────
async function cfdiTxt(req, res, next) {
  try {
    const { relativePath } = await generarCfdiTxt(req.params.id);
    res.json({ url: relativePath });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message, faltantes: err.faltantes || [] });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function cargarEntrega(id) {
  const [[ent]] = await pool.query(
    `SELECT e.*, c.razon_social AS cliente_nombre, p.folio AS pedido_folio
     FROM entregas e JOIN clientes c ON c.id = e.cliente_id JOIN pedidos_cliente p ON p.id = e.pedido_id WHERE e.id = ?`, [id]
  );
  if (!ent) return null;
  const [partidas] = await pool.query('SELECT * FROM entregas_partidas WHERE entrega_id = ? ORDER BY id', [id]);
  return { ...ent, partidas };
}

async function entregaPdf(req, res, next) {
  try {
    const [[ent]] = await pool.query('SELECT pdf_path FROM entregas WHERE id = ?', [req.params.id]);
    if (!ent) return res.status(404).json({ error: 'Entrega no encontrada' });
    if (ent.pdf_path) return res.json({ url: ent.pdf_path });
    const full = await cargarEntrega(req.params.id);
    const { relativePath } = await generarEntregaPdf(full);
    await pool.query('UPDATE entregas SET pdf_path = ? WHERE id = ?', [relativePath, req.params.id]);
    res.json({ url: relativePath });
  } catch (err) { next(err); }
}

// ── TIMBRADO CFDI (Facturama) ─────────────────────────────────────────────────
async function timbrarCfdi(req, res, next) {
  try {
    const r = await timbrarEntrega(req.params.id);
    res.json(r);
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message, faltantes: err.faltantes || [] });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function cancelarCfdi(req, res, next) {
  try {
    const { motivo, uuidSustituye } = req.body;
    const r = await cancelarCfdiSvc(req.params.id, { motivo, uuidSustituye });
    res.json(r);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function cfdiInfo(req, res, next) {
  try {
    const [[c]] = await pool.query(
      'SELECT * FROM cfdi_comprobantes WHERE entrega_id = ? ORDER BY id DESC LIMIT 1',
      [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'La entrega no tiene CFDI' });
    res.json(c);
  } catch (err) { next(err); }
}

module.exports = {
  crearPedido, listPedidos, getPedido,
  generarOC, getOC, ocPdf, recepcion,
  crearEntrega, entregaPdf, cfdiTxt,
  timbrarCfdi, cancelarCfdi, cfdiInfo,
};
