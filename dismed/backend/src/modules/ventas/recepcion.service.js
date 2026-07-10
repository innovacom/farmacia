/**
 * Lógica transaccional de la recepción de mercancía contra una Orden de Compra.
 * Extraída de ventas.controller.js recepcion() para que también la use el módulo
 * de ingestion (recepción automática desde factura en PDF, ver DISEÑO_INTEGRACION_FACTURAS_N8N.md).
 *
 * Recibe una conexión `conn` con transacción ABIERTA por el llamador (mismo patrón que
 * inventario/movimientos.service.js), y lanza errores con `.status` en vez de responder HTTP.
 */
const svc = require('../inventario/movimientos.service');

async function ejecutarRecepcion(conn, { oc_id, almacen_id, partidas, usuario_id = null }) {
  if (!almacen_id || !Array.isArray(partidas) || !partidas.length) {
    throw Object.assign(new Error('almacen_id y partidas[] requeridos'), { status: 400 });
  }
  const [[oc]] = await conn.query('SELECT * FROM ordenes_compra WHERE id = ?', [oc_id]);
  if (!oc) throw Object.assign(new Error('OC no encontrada'), { status: 404 });

  const folio = await svc.genFolio(conn, 'REC');
  const [r] = await conn.query(
    'INSERT INTO recepciones (folio, oc_id, almacen_id, usuario_id) VALUES (?, ?, ?, ?)',
    [folio, oc.id, almacen_id, usuario_id]
  );
  const recId = r.insertId;

  for (const it of partidas) {
    const cant = parseFloat(it.cantidad);
    if (!(cant > 0)) continue;
    const [[ocp]] = await conn.query('SELECT * FROM ordenes_compra_partidas WHERE id = ? AND oc_id = ?', [it.oc_partida_id, oc.id]);
    if (!ocp) continue;
    const pend = Number(ocp.cantidad) - Number(ocp.cantidad_recibida);
    if (cant > pend + 0.0001) {
      throw Object.assign(new Error(`La cantidad recibida (${cant}) excede lo pendiente (${pend}) en ${ocp.sku_interno}`), { status: 400 });
    }
    if (!ocp.producto_id) {
      throw Object.assign(new Error(`La partida ${ocp.sku_interno} no tiene producto de catálogo y no puede entrar a inventario`), { status: 400 });
    }

    const costoUnitario = it.costo_unitario != null ? parseFloat(it.costo_unitario) : ocp.precio_compra;
    const ent = await svc.registrarEntrada(conn, {
      producto_id: ocp.producto_id, almacen_id, ubicacion_id: it.ubicacion_id || null,
      cantidad: cant, costo_unitario: costoUnitario,
      proveedor_id: oc.proveedor_id, numero_lote: it.numero_lote, fecha_caducidad: it.fecha_caducidad || null,
      motivo: `Recepción ${folio}`, referencia: oc.folio, usuario_id, permitir_sin_lote: true,
    });
    await conn.query(
      `INSERT INTO recepciones_partidas (recepcion_id, oc_partida_id, producto_id, cantidad, numero_lote, fecha_caducidad, ubicacion_id, costo_unitario, movimiento_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [recId, ocp.id, ocp.producto_id, cant, it.numero_lote || null, it.fecha_caducidad || null, it.ubicacion_id || null,
       costoUnitario, ent.lote_id || null]
    );
    await conn.query('UPDATE ordenes_compra_partidas SET cantidad_recibida = cantidad_recibida + ? WHERE id = ?', [cant, ocp.id]);
    await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_recibida = cantidad_recibida + ? WHERE id = ?', [cant, ocp.pedido_partida_id]);
  }

  const [[resumen]] = await conn.query(
    'SELECT SUM(cantidad) cant, SUM(cantidad_recibida) rec FROM ordenes_compra_partidas WHERE oc_id = ?', [oc.id]
  );
  const nuevoEstatus = Number(resumen.rec) >= Number(resumen.cant) ? 'recibida' : 'parcial';
  await conn.query('UPDATE ordenes_compra SET estatus = ? WHERE id = ?', [nuevoEstatus, oc.id]);

  return { folio, estatus_oc: nuevoEstatus, recepcion_id: recId };
}

module.exports = { ejecutarRecepcion };
