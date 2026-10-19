/**
 * Reserva de mercancía de inventario para pedidos de cliente.
 *
 * Una reserva NO mueve inventario: es un contador (pedidos_cliente_partidas.cantidad_reservada) con las
 * piezas que ya existen en almacén y están apartadas para esa partida hasta que se confirme su entrega.
 *   stock libre de un producto = existencia (Σ lotes) − Σ cantidad_reservada de todas las partidas.
 *
 * Todas las funciones reciben una conexión `conn` con transacción ABIERTA por el llamador.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Serializa operaciones de reserva sobre un producto (evita doble reserva concurrente). */
async function bloquearProducto(conn, productoId) {
  await conn.query('SELECT id FROM productos WHERE id = ? FOR UPDATE', [productoId]);
}

/** Existencia, reservado y libre de un producto. */
async function stockProducto(conn, productoId) {
  const [[e]] = await conn.query(
    'SELECT COALESCE(SUM(cantidad_actual), 0) AS existencia FROM inventario_lotes WHERE producto_id = ?', [productoId]);
  const [[r]] = await conn.query(
    'SELECT COALESCE(SUM(cantidad_reservada), 0) AS reservado FROM pedidos_cliente_partidas WHERE producto_id = ?', [productoId]);
  const existencia = Number(e.existencia), reservado = Number(r.reservado);
  return { existencia, reservado, libre: Math.max(0, r2(existencia - reservado)) };
}

/** Piezas de una partida comprometidas en entregas pendientes de confirmar. */
async function enEntregaPendiente(conn, pedidoPartidaId) {
  const [[r]] = await conn.query(
    `SELECT COALESCE(SUM(ep.cantidad), 0) AS cant
       FROM entregas_partidas ep JOIN entregas e ON e.id = ep.entrega_id
      WHERE ep.pedido_partida_id = ? AND e.estatus = 'pendiente'`, [pedidoPartidaId]);
  return Number(r.cant);
}

/**
 * Reserva, para una partida, lo que alcance del stock libre (hasta lo que le falta por cubrir).
 * Devuelve las piezas reservadas ahora.
 */
async function reservarPartida(conn, pp) {
  if (!pp.producto_id) return 0;
  await bloquearProducto(conn, pp.producto_id);
  const [[fresco]] = await conn.query(
    'SELECT cantidad_asignada, cantidad_entregada, cantidad_reservada FROM pedidos_cliente_partidas WHERE id = ?', [pp.id]);
  const falta = r2(Number(fresco.cantidad_asignada) - Number(fresco.cantidad_entregada) - Number(fresco.cantidad_reservada));
  if (falta <= 0) return 0;
  const { libre } = await stockProducto(conn, pp.producto_id);
  const cant = Math.floor(Math.min(falta, libre));
  if (cant <= 0) return 0;
  await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_reservada = cantidad_reservada + ? WHERE id = ?', [cant, pp.id]);
  return cant;
}

/** Reserva el inventario disponible para todas las partidas de un pedido recién creado. */
async function reservarPedido(conn, pedidoId) {
  const [partidas] = await conn.query('SELECT id, producto_id FROM pedidos_cliente_partidas WHERE pedido_id = ? ORDER BY id', [pedidoId]);
  let total = 0;
  for (const pp of partidas) total += await reservarPartida(conn, pp);
  return total;
}

/**
 * Mercancía recién recibida de un proveedor para esta partida: queda apartada para el pedido
 * (sin rebasar lo que aún le falta cubrir).
 */
async function reservarRecibido(conn, pedidoPartidaId, cantidad) {
  const [[pp]] = await conn.query(
    'SELECT cantidad_asignada, cantidad_entregada, cantidad_reservada FROM pedidos_cliente_partidas WHERE id = ? FOR UPDATE', [pedidoPartidaId]);
  if (!pp) return 0;
  const falta = r2(Number(pp.cantidad_asignada) - Number(pp.cantidad_entregada) - Number(pp.cantidad_reservada));
  const cant = Math.min(Number(cantidad), falta);
  if (!(cant > 0)) return 0;
  await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_reservada = cantidad_reservada + ? WHERE id = ?', [cant, pedidoPartidaId]);
  return cant;
}

/**
 * Libera la reserva de una partida que NO está comprometida en una entrega pendiente.
 * Devuelve las piezas liberadas. Se usa cuando el usuario pide explícitamente a proveedor lo reservado.
 */
async function liberarReservaPartida(conn, pedidoPartidaId) {
  const [[pp]] = await conn.query('SELECT cantidad_reservada FROM pedidos_cliente_partidas WHERE id = ? FOR UPDATE', [pedidoPartidaId]);
  if (!pp) return 0;
  const enPend = await enEntregaPendiente(conn, pedidoPartidaId);
  const liberable = r2(Number(pp.cantidad_reservada) - enPend);
  if (liberable <= 0) return 0;
  await conn.query('UPDATE pedidos_cliente_partidas SET cantidad_reservada = cantidad_reservada - ? WHERE id = ?', [liberable, pedidoPartidaId]);
  return liberable;
}

module.exports = {
  stockProducto, enEntregaPendiente, bloquearProducto,
  reservarPartida, reservarPedido, reservarRecibido, liberarReservaPartida,
};
