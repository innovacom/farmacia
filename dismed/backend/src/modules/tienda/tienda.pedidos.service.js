/**
 * tienda.pedidos.service.js — Lado STAFF de los pedidos pagados en línea con
 * Stripe (ver tienda.checkout.service.js para cómo nacen, siempre desde el
 * webhook). Clon de whatsapp.pedidos.service.js con dos diferencias: no hay
 * contacto_id/receta (el comprador es un invitado sin cuenta, y solo se
 * vende libre venta — ver CLASIF_LIBRES en tienda.checkout.service.js), y
 * cancelar además dispara un reembolso REAL en Stripe (un pedido de
 * WhatsApp nunca se cobra por adelantado; uno de la tienda sí).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('../pos/pos.tenant.helpers');
const inv = require('../inventario/movimientos.service');
const stripeConfig = require('./tienda.stripe.config');

async function listar(empresaId, { estatus } = {}) {
  const params = [empresaId];
  let where = 'p.empresa_id = ?';
  if (estatus) { where += ' AND p.estatus = ?'; params.push(estatus); }
  const [rows] = await pool.query(
    `SELECT p.*, s.nombre AS sucursal
     FROM pedidos_tienda p
     JOIN sucursales s ON s.id = p.sucursal_id
     WHERE ${where}
     ORDER BY p.id DESC LIMIT 300`,
    params
  );
  return rows;
}

async function detalle(empresaId, id) {
  const pedido = await getScoped(pool, 'pedidos_tienda', id, empresaId);
  const [[sucursal]] = await pool.query('SELECT nombre FROM sucursales WHERE id = ?', [pedido.sucursal_id]);
  const [partidas] = await pool.query(
    'SELECT * FROM pedidos_tienda_partidas WHERE pedido_id = ? ORDER BY id', [id]
  );
  return { ...pedido, sucursal: sucursal?.nombre, partidas };
}

const TRANSICIONES = {
  preparando: ['pendiente'],
  listo: ['preparando'],
  en_reparto: ['listo'],
};

async function cambiarEstatus(empresaId, id, nuevoEstatus) {
  const pedido = await getScoped(pool, 'pedidos_tienda', id, empresaId);
  const permitidos = TRANSICIONES[nuevoEstatus];
  if (!permitidos.includes(pedido.estatus)) {
    throw Object.assign(new Error(`No se puede pasar de "${pedido.estatus}" a "${nuevoEstatus}"`), { status: 409 });
  }
  if (nuevoEstatus === 'en_reparto' && pedido.forma_entrega !== 'domicilio') {
    throw Object.assign(new Error('Solo aplica reparto para pedidos a domicilio'), { status: 400 });
  }
  await pool.query('UPDATE pedidos_tienda SET estatus = ? WHERE id = ?', [nuevoEstatus, id]);
  return { ok: true };
}

async function entregar(empresaId, id) {
  const pedido = await getScoped(pool, 'pedidos_tienda', id, empresaId);
  const previosValidos = pedido.forma_entrega === 'domicilio' ? ['en_reparto'] : ['listo', 'preparando', 'pendiente'];
  if (!previosValidos.includes(pedido.estatus)) {
    throw Object.assign(new Error(`No se puede entregar un pedido en estatus "${pedido.estatus}"`), { status: 409 });
  }
  await pool.query(`UPDATE pedidos_tienda SET estatus = 'entregado', entregado_en = NOW() WHERE id = ?`, [id]);
  return { ok: true };
}

// Cancela, reingresa TODO el inventario apartado (por lote exacto, igual que
// whatsapp.pedidos.service#cancelar) Y reembolsa en Stripe — a diferencia de
// un pedido de WhatsApp, este SÍ se cobró por adelantado.
async function cancelar(empresaId, id, { motivo, usuario_id }) {
  if (!motivo || !motivo.trim()) {
    throw Object.assign(new Error('Debes indicar un motivo de cancelación'), { status: 400 });
  }
  const conn = await pool.getConnection();
  let pedido;
  try {
    await conn.beginTransaction();
    pedido = await getScoped(conn, 'pedidos_tienda', id, empresaId, { forUpdate: true });
    if (pedido.estatus === 'entregado') {
      throw Object.assign(new Error('El pedido ya fue entregado; no se puede cancelar'), { status: 409 });
    }
    if (pedido.estatus === 'cancelado') {
      throw Object.assign(new Error('El pedido ya está cancelado'), { status: 409 });
    }
    const [partidas] = await conn.query('SELECT * FROM pedidos_tienda_partidas WHERE pedido_id = ?', [id]);
    const [[sucursal]] = await conn.query('SELECT almacen_id FROM sucursales WHERE id = ?', [pedido.sucursal_id]);

    for (const p of partidas) {
      const lotes = typeof p.lotes_json === 'string' ? JSON.parse(p.lotes_json || '[]') : (p.lotes_json || []);
      for (const l of lotes) {
        await inv.registrarEntrada(conn, {
          producto_id: p.producto_id,
          almacen_id: sucursal.almacen_id,
          ubicacion_id: null,
          cantidad: l.cantidad,
          numero_lote: l.lote,
          fecha_caducidad: l.caducidad ? String(l.caducidad).slice(0, 10) : null,
          motivo: 'cancelacion_pedido_tienda',
          referencia: pedido.folio,
          usuario_id,
          permitir_sin_lote: true,
        });
      }
    }
    await conn.query(
      `UPDATE pedidos_tienda SET estatus = 'cancelado', motivo_cancelacion = ?, cancelado_por = ?, cancelado_en = NOW() WHERE id = ?`,
      [motivo.trim(), usuario_id, id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Reembolso fuera de la transacción de BD que ya se confirmó — igual que
  // el reembolso automático de tienda.checkout.service#crearPedidoCanceladoYReembolsar:
  // primero el estado en BD, después el dinero, con idempotencyKey por si
  // el admin da doble clic.
  const stripe = stripeConfig.cliente();
  if (pedido.stripe_payment_intent_id && stripe) {
    try {
      await stripe.refunds.create(
        { payment_intent: pedido.stripe_payment_intent_id },
        { idempotencyKey: 'refund_manual_' + pedido.stripe_session_id }
      );
      await pool.query('UPDATE pedidos_tienda SET reembolsado_en = NOW() WHERE id = ?', [id]);
    } catch (err) {
      await pool.query('UPDATE pedidos_tienda SET reembolso_error = ? WHERE id = ?', [err.message.slice(0, 255), id]);
      throw Object.assign(new Error('El pedido se canceló, pero el reembolso automático falló — hazlo a mano desde el panel de Stripe'), { status: 502 });
    }
  }
  return { ok: true };
}

module.exports = { listar, detalle, cambiarEstatus, entregar, cancelar };
