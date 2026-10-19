const { pool } = require('../../config/db');
const svc = require('../inventario/movimientos.service');
const reservas = require('./reservas.service');
const { ejecutarRecepcion } = require('./recepcion.service');
const { generarOcPdf, generarEntregaPdf } = require('./ventas.pdf');
const { validarFactura, generarCfdiTxt } = require('./cfdi.txt.generator');
const cobranza = require('../cobranza/cobranza.service');
const { timbrarEntrega, cancelarCfdi: cancelarCfdiSvc, cargarEntregaCfdi: cargarEntrega } = require('./cfdi.facturama');
const { urlFirmada } = require('../../services/outputUrl.service');

async function genFolio(conn, serie) {
  await conn.query('CALL sp_generar_folio(?, @f)', [serie]);
  const [[{ f }]] = await conn.query('SELECT @f AS f');
  return f;
}

// ── PEDIDO (asignación del cliente) ───────────────────────────────────────────
async function crearPedido(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { cotizacion_id, partidas, notas, autorizar_credito } = req.body;
    if (!cotizacion_id || !Array.isArray(partidas) || !partidas.length) {
      return res.status(400).json({ error: 'cotizacion_id y partidas[] requeridos' });
    }
    await conn.beginTransaction();
    const [[cot]] = await conn.query('SELECT id, cliente_id, sucursal_id FROM cotizaciones_cliente WHERE id = ?', [cotizacion_id]);
    if (!cot) { await conn.rollback(); return res.status(404).json({ error: 'Cotización no encontrada' }); }

    const folio = await genFolio(conn, 'PED');
    const [r] = await conn.query(
      'INSERT INTO pedidos_cliente (folio, cotizacion_id, cliente_id, sucursal_id, notas, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
      [folio, cotizacion_id, cot.cliente_id, cot.sucursal_id || null, notas || null, req.user?.id || null]
    );
    const pedidoId = r.insertId;
    let montoPedido = 0;

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
      montoPedido += cant * Number(ccp.precio_unitario_venta || 0) * (ccp.iva_exento ? 1 : 1.16);
    }

    // Control de crédito (por sucursal y consolidado del cliente). Modo aviso: solo advierte;
    // modo bloqueo: rechaza salvo que un admin lo autorice explícitamente.
    const cred = await cobranza.verificarCredito(conn, cot.cliente_id, cot.sucursal_id, montoPedido);
    if (cred.excede && (await cobranza.getModo(conn)) === 'bloqueo' && !(autorizar_credito && req.user?.rol === 'admin')) {
      await conn.rollback();
      return res.status(409).json({
        error: cred.avisos.join(' '),
        requiere_autorizacion: req.user?.rol === 'admin',
        sin_permiso_credito: req.user?.rol !== 'admin',
      });
    }
    // Pedido en firme: aparta del inventario lo que ya hay disponible (no se vuelve a pedir a proveedor).
    const piezasReservadas = await reservas.reservarPedido(conn, pedidoId);
    await conn.query("UPDATE cotizaciones_cliente SET estatus = 'aceptada' WHERE id = ? AND estatus <> 'aceptada'", [cotizacion_id]);
    await conn.commit();
    res.status(201).json({ id: pedidoId, folio, piezas_reservadas: piezasReservadas, aviso_credito: cred.avisos.length ? cred.avisos.join(' ') : null });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
}

async function listPedidos(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.folio, p.estatus, p.created_at, c.razon_social AS cliente, su.nombre AS sucursal,
              cot.folio AS cotizacion_folio,
              (SELECT COUNT(*) FROM pedidos_cliente_partidas pp WHERE pp.pedido_id = p.id) AS partidas
       FROM pedidos_cliente p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = p.sucursal_id
       JOIN cotizaciones_cliente cot ON cot.id = p.cotizacion_id
       ORDER BY p.id DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getPedido(req, res, next) {
  try {
    const [[ped]] = await pool.query(
      `SELECT p.*, c.razon_social AS cliente, c.uso_cfdi AS cliente_uso_cfdi, c.forma_pago AS cliente_forma_pago,
              c.metodo_pago AS cliente_metodo_pago, su.nombre AS sucursal, cot.folio AS cotizacion_folio
       FROM pedidos_cliente p JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = p.sucursal_id
       JOIN cotizaciones_cliente cot ON cot.id = p.cotizacion_id WHERE p.id = ?`, [req.params.id]
    );
    if (!ped) return res.status(404).json({ error: 'Pedido no encontrado' });
    const [partidas] = await pool.query(
      `SELECT pp.*, pr.nombre_empresa AS proveedor,
              COALESCE((SELECT SUM(cantidad_actual) FROM inventario_lotes il WHERE il.producto_id = pp.producto_id), 0) AS stock,
              COALESCE((SELECT SUM(x.cantidad_reservada) FROM pedidos_cliente_partidas x WHERE x.producto_id = pp.producto_id), 0) AS reservado_total,
              COALESCE((SELECT SUM(ep.cantidad) FROM entregas_partidas ep JOIN entregas e ON e.id = ep.entrega_id
                         WHERE ep.pedido_partida_id = pp.id AND e.estatus = 'pendiente'), 0) AS en_entrega_pendiente
       FROM pedidos_cliente_partidas pp
       LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
       WHERE pp.pedido_id = ? ORDER BY pp.id`, [req.params.id]
    );
    for (const p of partidas) {
      const existencia = Number(p.stock), reservadoTotal = Number(p.reservado_total);
      p.stock_libre = Math.max(0, existencia - reservadoTotal);
      const porEntregar = Number(p.cantidad_asignada) - Number(p.cantidad_entregada) - Number(p.en_entrega_pendiente);
      // Sugerido: lo reservado para este pedido (sin comprometer) + lo que quede libre en almacén.
      const propio = Number(p.cantidad_reservada) - Number(p.en_entrega_pendiente);
      p.sugerido_entrega = Math.max(0, Math.floor(Math.min(porEntregar, propio + p.stock_libre)));
    }
    const [ocs] = await pool.query(
      `SELECT oc.*, pr.nombre_empresa AS proveedor FROM ordenes_compra oc
       JOIN proveedores pr ON pr.id = oc.proveedor_id WHERE oc.pedido_id = ? ORDER BY oc.id`, [req.params.id]
    );
    const [entregas] = await pool.query(
      `SELECT e.id, e.folio, e.tipo, e.total, e.pdf_path, e.cfdi_txt_path, e.estatus_cfdi, e.created_at, f.folio AS factura_folio,
              e.estatus, e.motivo_cancelacion, e.cancelada_at
         FROM entregas e LEFT JOIN entregas f ON f.id = e.factura_id
        WHERE e.pedido_id = ? OR e.id IN (SELECT r.factura_id FROM entregas r WHERE r.pedido_id = ? AND r.factura_id IS NOT NULL)
        ORDER BY e.id DESC`, [req.params.id, req.params.id]
    );
    // Líneas de las entregas pendientes (para confirmar / cancelar parcialmente)
    const pendIds = entregas.filter((e) => e.estatus === 'pendiente').map((e) => e.id);
    if (pendIds.length) {
      const [lineas] = await pool.query(
        'SELECT id, entrega_id, pedido_partida_id, sku_interno, descripcion, cantidad FROM entregas_partidas WHERE entrega_id IN (?) ORDER BY id', [pendIds]);
      for (const e of entregas) e.partidas = lineas.filter((l) => l.entrega_id === e.id);
    }
    res.json({ ...ped, partidas, ordenes_compra: ocs, entregas });
  } catch (err) { next(err); }
}

// ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────────────
async function listOrdenesCompra(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT oc.id, oc.folio, oc.estatus, oc.total, oc.created_at,
              pr.id AS proveedor_id, pr.nombre_empresa AS proveedor,
              p.id AS pedido_id, p.folio AS pedido_folio,
              (SELECT COUNT(*) FROM ordenes_compra_partidas ocp WHERE ocp.oc_id = oc.id) AS partidas
       FROM ordenes_compra oc
       JOIN proveedores pr ON pr.id = oc.proveedor_id
       JOIN pedidos_cliente p ON p.id = oc.pedido_id
       ORDER BY oc.id DESC LIMIT 500`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function generarOC(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ped]] = await conn.query('SELECT * FROM pedidos_cliente WHERE id = ?', [req.params.id]);
    if (!ped) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    // Por defecto NO se pide a proveedor lo que está reservado del inventario. Solo si el usuario lo pide
    // explícitamente (incluir_reservado_partidas = ids de partidas) se libera esa reserva y se incluye.
    const incluirIds = new Set((Array.isArray(req.body?.incluir_reservado_partidas) ? req.body.incluir_reservado_partidas : []).map(Number));
    for (const id of incluirIds) {
      const [[chk]] = await conn.query('SELECT id FROM pedidos_cliente_partidas WHERE id = ? AND pedido_id = ?', [id, req.params.id]);
      if (chk) await reservas.liberarReservaPartida(conn, id);
    }
    const [partidas] = await conn.query('SELECT * FROM pedidos_cliente_partidas WHERE pedido_id = ?', [req.params.id]);
    // Cantidad ya ordenada por partida
    const [yaOrd] = await conn.query(
      `SELECT ocp.pedido_partida_id, SUM(ocp.cantidad) ordenada
       FROM ordenes_compra_partidas ocp JOIN ordenes_compra oc ON oc.id = ocp.oc_id
       WHERE oc.pedido_id = ? AND oc.estatus <> 'cancelada' GROUP BY ocp.pedido_partida_id`, [req.params.id]
    );
    const ordMap = {}; yaOrd.forEach((x) => { ordMap[x.pedido_partida_id] = Number(x.ordenada); });

    // Agrupar pendientes por proveedor.
    // Cubierto = ya entregado + reservado vivo + lo ordenado que aún no llega (lo recibido ya está en reservado/entregado).
    const porProv = {};
    for (const pp of partidas) {
      if (!pp.proveedor_id) continue;
      const ordenada = ordMap[pp.id] || 0;
      const enCamino = Math.max(0, ordenada - Number(pp.cantidad_recibida));
      const pend = Number(pp.cantidad_asignada) - Number(pp.cantidad_entregada) - Number(pp.cantidad_reservada) - enCamino;
      if (pend <= 0) continue;
      (porProv[pp.proveedor_id] = porProv[pp.proveedor_id] || []).push({ pp, pend });
    }
    if (!Object.keys(porProv).length) { await conn.rollback(); return res.status(400).json({ error: 'No hay partidas pendientes por pedir a proveedor (lo reservado del inventario no se pide; si quieres pedirlo, márcalo explícitamente)' }); }

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
    if (oc.pdf_path) return res.json({ url: urlFirmada(oc.pdf_path) });
    const full = await cargarOC(req.params.id);
    const { relativePath } = await generarOcPdf(full);
    await pool.query('UPDATE ordenes_compra SET pdf_path = ? WHERE id = ?', [relativePath, req.params.id]);
    res.json({ url: urlFirmada(relativePath) });
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

// ── ENTREGA al cliente (remisión/factura) ─────────────────────────────────────
// Flujo: crearEntrega → 'pendiente' (sugerida; NO toca inventario, solo aparta) →
//        confirmarEntrega → 'confirmada' (aquí se descuenta el inventario por FEFO y se emite el documento)
//        cancelarEntrega  → 'cancelada' (total) o reduce líneas (parcial), siempre con motivo.
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
      `INSERT INTO entregas (folio, tipo, estatus, pedido_id, cliente_id, sucursal_id, usuario_id, notas, forma_pago, metodo_pago, moneda, uso_cfdi)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, tipoFinal, ped.id, ped.cliente_id, ped.sucursal_id || null, req.user?.id || null, String(notas || '').trim().slice(0, 300) || null,
       cfdiHeader.forma_pago, cfdiHeader.metodo_pago, cfdiHeader.moneda, cfdiHeader.uso_cfdi]
    );
    const entId = r.insertId;
    let subtotal = 0, iva = 0, lineas = 0;
    const partidasFactura = []; // para validar CFDI antes de crear

    for (const it of partidas) {
      const cant = parseFloat(it.cantidad);
      if (!(cant > 0)) continue;
      const [[pp]] = await conn.query('SELECT * FROM pedidos_cliente_partidas WHERE id = ? AND pedido_id = ? FOR UPDATE', [it.pedido_partida_id, ped.id]);
      if (!pp) continue;
      if (!pp.producto_id) { await conn.rollback(); return res.status(400).json({ error: `${pp.descripcion} no tiene producto de catálogo` }); }

      const enPend = await reservas.enEntregaPendiente(conn, pp.id);
      const porEntregar = Number(pp.cantidad_asignada) - Number(pp.cantidad_entregada) - enPend;
      if (cant > porEntregar + 0.0001) { await conn.rollback(); return res.status(400).json({ error: `${pp.sku_interno}: solo quedan ${porEntregar} por entregar (descontando entregas pendientes de confirmar)` }); }

      // La entrega debe estar respaldada por piezas apartadas para este pedido; si faltan, se apartan del stock libre.
      const falta = enPend + cant - Number(pp.cantidad_reservada);
      if (falta > 0.0001) {
        await reservas.bloquearProducto(conn, pp.producto_id);
        const { libre, existencia } = await reservas.stockProducto(conn, pp.producto_id);
        if (falta > libre + 0.0001) {
          await conn.rollback();
          return res.status(400).json({ error: `${pp.sku_interno}: sin existencia libre suficiente (existencia ${existencia}, libre ${libre}; el resto está reservado para otros pedidos)` });
        }
        await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_reservada = cantidad_reservada + ? WHERE id = ?', [falta, pp.id]);
      }

      await conn.query(
        `INSERT INTO entregas_partidas (entrega_id, pedido_partida_id, producto_id, sku_interno, descripcion, unidad_medida, cantidad, precio_unitario, iva_exento)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [entId, pp.id, pp.producto_id, pp.sku_interno, pp.descripcion, pp.unidad_medida, cant, pp.precio_unitario_venta, pp.iva_exento ? 1 : 0]
      );
      lineas++;
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
    if (!lineas) { await conn.rollback(); return res.status(400).json({ error: 'Captura cantidades a entregar' }); }

    // Validación CFDI 4.0 ANTES de crear: si faltan datos, no se crea la factura.
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
    res.status(201).json({ id: entId, folio, tipo: tipoFinal, estatus: 'pendiente' });
  } catch (err) { await conn.rollback(); if (err.status) return res.status(err.status).json({ error: err.message }); next(err); } finally { conn.release(); }
}

// Confirma una entrega pendiente: descuenta el inventario (FEFO), cierra la reserva y emite PDF / TXT CFDI.
async function confirmarEntrega(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ent]] = await conn.query('SELECT * FROM entregas WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ent) { await conn.rollback(); return res.status(404).json({ error: 'Entrega no encontrada' }); }
    if (ent.estatus !== 'pendiente') { await conn.rollback(); return res.status(409).json({ error: `La entrega ya está ${ent.estatus}` }); }

    const [lineas] = await conn.query('SELECT * FROM entregas_partidas WHERE entrega_id = ? ORDER BY id', [ent.id]);
    const partidasFactura = [];
    for (const l of lineas) {
      const cant = Number(l.cantidad);
      if (!(cant > 0)) continue;
      const [[pp]] = await conn.query('SELECT * FROM pedidos_cliente_partidas WHERE id = ? FOR UPDATE', [l.pedido_partida_id]);
      // Salida FEFO (valida existencia real; no permite negativo)
      await svc.registrarSalidaFEFO(conn, {
        producto_id: l.producto_id, cantidad: cant, usarReservado: true, // sale de lo apartado para este pedido
        motivo: `Entrega ${ent.folio} (${ent.tipo})`, referencia: ent.folio, usuario_id: req.user?.id || null,
      });
      await conn.query(
        `UPDATE pedidos_cliente_partidas
            SET cantidad_entregada = cantidad_entregada + ?, cantidad_reservada = GREATEST(0, cantidad_reservada - ?)
          WHERE id = ?`, [cant, cant, pp.id]);
      if (ent.tipo === 'factura') {
        const [[prod]] = await conn.query('SELECT clave_sat, clave_unidad_sat FROM productos WHERE id = ?', [l.producto_id]);
        partidasFactura.push({ id: pp.id, sku_interno: l.sku_interno, descripcion: l.descripcion, iva_exento: l.iva_exento,
          clave_sat: prod?.clave_sat || null, clave_unidad_sat: prod?.clave_unidad_sat || null });
      }
    }
    if (ent.tipo === 'factura') {
      const [[cliente]] = await conn.query('SELECT * FROM clientes WHERE id = ?', [ent.cliente_id]);
      const v = validarFactura({ entrega: ent, cliente, partidas: partidasFactura });
      if (!v.ok) {
        await conn.rollback();
        return res.status(422).json({ error: 'Faltan datos fiscales para emitir la factura (CFDI 4.0)', faltantes: v.faltantes });
      }
    }
    await conn.query("UPDATE entregas SET estatus = 'confirmada', confirmada_at = NOW(), confirmada_por = ? WHERE id = ?", [req.user?.id || null, ent.id]);
    await conn.commit();

    let url = null;
    try {
      const full = await cargarEntrega(ent.id);
      const { relativePath } = await generarEntregaPdf(full);
      await pool.query('UPDATE entregas SET pdf_path = ? WHERE id = ?', [relativePath, ent.id]);
      url = urlFirmada(relativePath);
    } catch (e) { /* regenerable */ }
    let cfdi_txt = null;
    if (ent.tipo === 'factura') {
      try { cfdi_txt = urlFirmada((await generarCfdiTxt(ent.id)).relativePath); } catch (e) { /* regenerable vía endpoint */ }
    }
    res.json({ id: ent.id, folio: ent.folio, tipo: ent.tipo, estatus: 'confirmada', url, cfdi_txt });
  } catch (err) { await conn.rollback(); if (err.status) return res.status(err.status).json({ error: err.message }); next(err); } finally { conn.release(); }
}

// Cancela una entrega PENDIENTE: completa (sin `partidas`) o parcial ([{entrega_partida_id, cantidad}]). Motivo obligatorio.
// Al no haberse descontado inventario, solo se reduce/anula la entrega; la reserva del pedido se conserva.
async function cancelarEntrega(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
    if (motivo.length < 3) return res.status(400).json({ error: 'Indica el motivo de la cancelación' });
    await conn.beginTransaction();
    const [[ent]] = await conn.query('SELECT * FROM entregas WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ent) { await conn.rollback(); return res.status(404).json({ error: 'Entrega no encontrada' }); }
    if (ent.estatus !== 'pendiente') {
      await conn.rollback();
      return res.status(409).json({ error: ent.estatus === 'cancelada' ? 'La entrega ya está cancelada' : 'La entrega ya fue confirmada y descontó inventario; no se puede cancelar desde aquí' });
    }
    const [lineas] = await conn.query('SELECT * FROM entregas_partidas WHERE entrega_id = ? ORDER BY id', [ent.id]);
    const parciales = Array.isArray(req.body?.partidas) && req.body.partidas.length ? req.body.partidas : null;
    // Mapa línea → piezas a cancelar
    const cancelar = new Map();
    if (parciales) {
      for (const it of parciales) {
        const l = lineas.find((x) => x.id === Number(it.entrega_partida_id));
        const c = parseFloat(it.cantidad);
        if (!l || !(c > 0)) continue;
        if (c > Number(l.cantidad) + 0.0001) { await conn.rollback(); return res.status(400).json({ error: `${l.sku_interno}: solo hay ${Number(l.cantidad)} en la entrega` }); }
        cancelar.set(l.id, c);
      }
      if (!cancelar.size) { await conn.rollback(); return res.status(400).json({ error: 'Indica qué cantidades cancelar' }); }
    } else {
      for (const l of lineas) cancelar.set(l.id, Number(l.cantidad));
    }

    let restantes = 0;
    const cancelaciones = [];
    for (const l of lineas) {
      const c = cancelar.get(l.id) || 0;
      const quedan = Math.round((Number(l.cantidad) - c) * 100) / 100;
      if (c > 0) {
        const [rc] = await conn.query(
          `INSERT INTO entregas_cancelaciones (entrega_id, entrega_partida_id, pedido_partida_id, sku_interno, cantidad, total_entrega, motivo, usuario_id)
           VALUES (?,?,?,?,?,0,?,?)`,
          [ent.id, l.id, l.pedido_partida_id, l.sku_interno, c, motivo, req.user?.id || null]);
        cancelaciones.push(rc.insertId);
        if (quedan > 0) await conn.query('UPDATE entregas_partidas SET cantidad = ? WHERE id = ?', [quedan, l.id]);
        else await conn.query('DELETE FROM entregas_partidas WHERE id = ?', [l.id]);
      }
      if (quedan > 0) restantes++;
    }
    if (restantes === 0) {
      if (cancelaciones.length) await conn.query('UPDATE entregas_cancelaciones SET total_entrega = 1 WHERE id IN (?)', [cancelaciones]);
      await conn.query(
        "UPDATE entregas SET estatus = 'cancelada', cancelada_at = NOW(), cancelada_por = ?, motivo_cancelacion = ?, subtotal = 0, iva = 0, total = 0 WHERE id = ?",
        [req.user?.id || null, motivo, ent.id]);
    } else {
      const [[t]] = await conn.query(
        `SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS sub,
                COALESCE(SUM(CASE WHEN iva_exento = 1 THEN 0 ELSE cantidad * precio_unitario * 0.16 END), 0) AS iva
           FROM entregas_partidas WHERE entrega_id = ?`, [ent.id]);
      const sub = Number(t.sub), iv = Number(t.iva);
      await conn.query('UPDATE entregas SET subtotal = ?, iva = ?, total = ? WHERE id = ?', [sub.toFixed(2), iv.toFixed(2), (sub + iv).toFixed(2), ent.id]);
    }
    await conn.commit();
    res.json({ ok: true, estatus: restantes === 0 ? 'cancelada' : 'pendiente' });
  } catch (err) { await conn.rollback(); if (err.status) return res.status(err.status).json({ error: err.message }); next(err); } finally { conn.release(); }
}

// Solo las entregas confirmadas generan documento / CFDI.
async function exigirConfirmada(id) {
  const [[e]] = await pool.query('SELECT estatus FROM entregas WHERE id = ?', [id]);
  if (!e) throw Object.assign(new Error('Entrega no encontrada'), { status: 404 });
  if (e.estatus !== 'confirmada') throw Object.assign(new Error('Confirma la entrega antes de generar el documento'), { status: 409 });
}

// ── TXT CFDI (regenerar / descargar) ──────────────────────────────────────────
async function cfdiTxt(req, res, next) {
  try {
    await exigirConfirmada(req.params.id);
    const { relativePath } = await generarCfdiTxt(req.params.id);
    res.json({ url: urlFirmada(relativePath) });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message, faltantes: err.faltantes || [] });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function entregaPdf(req, res, next) {
  try {
    await exigirConfirmada(req.params.id);
    const [[ent]] = await pool.query('SELECT pdf_path FROM entregas WHERE id = ?', [req.params.id]);
    if (!ent) return res.status(404).json({ error: 'Entrega no encontrada' });
    if (ent.pdf_path) return res.json({ url: urlFirmada(ent.pdf_path) });
    const full = await cargarEntrega(req.params.id);
    const { relativePath } = await generarEntregaPdf(full);
    await pool.query('UPDATE entregas SET pdf_path = ? WHERE id = ?', [relativePath, req.params.id]);
    res.json({ url: urlFirmada(relativePath) });
  } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); next(err); }
}

// ── TIMBRADO CFDI (Facturama) ─────────────────────────────────────────────────
async function timbrarCfdi(req, res, next) {
  try {
    await exigirConfirmada(req.params.id);
    const r = await timbrarEntrega(req.params.id);
    if (r.xml_url) r.xml_url = urlFirmada(r.xml_url);
    if (r.pdf_url) r.pdf_url = urlFirmada(r.pdf_url);
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
    if (c.xml_path) c.xml_path = urlFirmada(c.xml_path);
    if (c.pdf_path) c.pdf_path = urlFirmada(c.pdf_path);
    res.json(c);
  } catch (err) { next(err); }
}

module.exports = {
  crearPedido, listPedidos, getPedido,
  listOrdenesCompra, generarOC, getOC, ocPdf, recepcion,
  crearEntrega, confirmarEntrega, cancelarEntrega, entregaPdf, cfdiTxt,
  timbrarCfdi, cancelarCfdi, cfdiInfo,
};
