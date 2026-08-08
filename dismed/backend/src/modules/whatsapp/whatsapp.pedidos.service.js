/**
 * whatsapp.pedidos.service.js — Lado STAFF de los pedidos en firme creados
 * por el carrito conversacional de WhatsApp (ver whatsapp.carrito.service.js
 * para cómo se arman/confirman). Aquí solo viven las transiciones de estatus
 * que opera un empleado (preparar/listo/reparto/entregar/cancelar) y la
 * validación de la foto de receta para controlados.
 *
 * Cancelar SIEMPRE reingresa el inventario apartado en la confirmación,
 * usando el `lotes_json` guardado por partida (mismo patrón exacto que
 * pos.ventas.service#cancelarVenta: reingreso por lote, sin ubicación).
 */
const { pool } = require('../../config/db');
const { getScoped } = require('../pos/pos.tenant.helpers');
const inv = require('../inventario/movimientos.service');
const waService = require('./whatsapp.service');

async function listar(empresaId, { estatus, receta_estatus } = {}) {
  const params = [empresaId];
  let where = 'p.empresa_id = ?';
  if (estatus) { where += ' AND p.estatus = ?'; params.push(estatus); }
  if (receta_estatus) { where += ' AND p.receta_estatus = ?'; params.push(receta_estatus); }
  const [rows] = await pool.query(
    `SELECT p.*, c.nombre AS contacto_nombre, s.nombre AS sucursal
     FROM pedidos_whatsapp p
     JOIN whatsapp_contactos c ON c.id = p.contacto_id
     JOIN sucursales s ON s.id = p.sucursal_id
     WHERE ${where}
     ORDER BY p.id DESC LIMIT 300`,
    params
  );
  return rows;
}

async function detalle(empresaId, id) {
  const pedido = await getScoped(pool, 'pedidos_whatsapp', id, empresaId);
  const [partidas] = await pool.query(
    'SELECT * FROM pedidos_whatsapp_partidas WHERE pedido_id = ? ORDER BY id', [id]
  );
  const [[contacto]] = await pool.query(
    'SELECT nombre, telefono FROM whatsapp_contactos WHERE id = ?', [pedido.contacto_id]
  );
  return { ...pedido, contacto_nombre: contacto?.nombre || null, partidas };
}

// Ruta absoluta de la foto (para que el controller la stree), con el mismo
// candado de tenant que el resto del módulo — nunca se sirve como estático.
async function rutaFotoReceta(empresaId, id) {
  const pedido = await getScoped(pool, 'pedidos_whatsapp', id, empresaId);
  if (!pedido.receta_foto_path) {
    const err = new Error('Este pedido no tiene foto de receta');
    err.status = 404;
    throw err;
  }
  return pedido.receta_foto_path;
}

async function validarReceta(empresaId, id, { aprobar, motivo_rechazo, usuario_id }) {
  const pedido = await getScoped(pool, 'pedidos_whatsapp', id, empresaId);
  if (pedido.receta_estatus !== 'recibida') {
    const err = new Error('Este pedido no tiene una foto de receta pendiente de revisar');
    err.status = 409;
    throw err;
  }
  await pool.query(
    `UPDATE pedidos_whatsapp
       SET receta_estatus = ?, receta_validada_por = ?, receta_validada_en = NOW(), receta_motivo_rechazo = ?
     WHERE id = ?`,
    [aprobar ? 'validada' : 'rechazada', usuario_id, aprobar ? null : (motivo_rechazo || null), id]
  );
  return { ok: true };
}

const TRANSICIONES = {
  preparando: ['pendiente'],
  listo: ['preparando'],
  en_reparto: ['listo'],
};

async function cambiarEstatus(empresaId, id, nuevoEstatus) {
  const pedido = await getScoped(pool, 'pedidos_whatsapp', id, empresaId);
  const permitidos = TRANSICIONES[nuevoEstatus];
  if (!permitidos.includes(pedido.estatus)) {
    const err = new Error(`No se puede pasar de "${pedido.estatus}" a "${nuevoEstatus}"`);
    err.status = 409;
    throw err;
  }
  if (nuevoEstatus === 'en_reparto' && pedido.forma_entrega !== 'domicilio') {
    const err = new Error('Solo aplica reparto para pedidos a domicilio');
    err.status = 400;
    throw err;
  }
  await pool.query('UPDATE pedidos_whatsapp SET estatus = ? WHERE id = ?', [nuevoEstatus, id]);
  if (nuevoEstatus === 'en_reparto') {
    const direccionTxt = pedido.direccion_entrega ? ` Va a: ${pedido.direccion_entrega}.` : '';
    await waService.enviarTexto(empresaId, pedido.telefono, `Tu pedido ${pedido.folio} va en camino.${direccionTxt}`);
  }
  if (nuevoEstatus === 'listo' && pedido.forma_entrega === 'pickup') {
    await waService.enviarTexto(empresaId, pedido.telefono, `Tu pedido ${pedido.folio} ya está listo, puedes pasar por él.`);
  }
  return { ok: true };
}

async function entregar(empresaId, id) {
  const pedido = await getScoped(pool, 'pedidos_whatsapp', id, empresaId);
  const previosValidos = pedido.forma_entrega === 'domicilio' ? ['en_reparto'] : ['listo', 'preparando', 'pendiente'];
  if (!previosValidos.includes(pedido.estatus)) {
    const err = new Error(`No se puede entregar un pedido en estatus "${pedido.estatus}"`);
    err.status = 409;
    throw err;
  }
  if (pedido.receta_estatus === 'pendiente' || pedido.receta_estatus === 'recibida') {
    const err = new Error('Este pedido tiene receta sin validar; valida o cancela antes de entregar');
    err.status = 409;
    throw err;
  }
  await pool.query(
    `UPDATE pedidos_whatsapp SET estatus = 'entregado', pagado = 1, entregado_en = NOW() WHERE id = ?`,
    [id]
  );
  await waService.enviarTexto(empresaId, pedido.telefono, `Tu pedido ${pedido.folio} fue entregado. ¡Gracias por tu compra!`);
  return { ok: true };
}

// Cancela y reingresa TODO el inventario apartado (por lote exacto). Cubre
// tanto "el repartidor regresó el pedido sin cobrar" como "no llegó/no es
// válida la receta" — en ambos casos un empleado decide, nunca es automático.
async function cancelar(empresaId, id, { motivo, usuario_id }) {
  if (!motivo || !motivo.trim()) {
    throw Object.assign(new Error('Debes indicar un motivo de cancelación'), { status: 400 });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const pedido = await getScoped(conn, 'pedidos_whatsapp', id, empresaId, { forUpdate: true });
    if (pedido.estatus === 'entregado') {
      throw Object.assign(new Error('El pedido ya fue entregado; no se puede cancelar'), { status: 409 });
    }
    if (pedido.estatus === 'cancelado') {
      throw Object.assign(new Error('El pedido ya está cancelado'), { status: 409 });
    }
    const [partidas] = await conn.query('SELECT * FROM pedidos_whatsapp_partidas WHERE pedido_id = ?', [id]);
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
          motivo: 'cancelacion_pedido_whatsapp',
          referencia: pedido.folio,
          usuario_id,
          permitir_sin_lote: true,
        });
      }
    }
    await conn.query(
      `UPDATE pedidos_whatsapp SET estatus = 'cancelado', motivo_cancelacion = ?, cancelado_por = ?, cancelado_en = NOW() WHERE id = ?`,
      [motivo.trim(), usuario_id, id]
    );
    await conn.commit();
    await waService.enviarTexto(empresaId, pedido.telefono, `Tu pedido ${pedido.folio} fue cancelado. Motivo: ${motivo.trim()}.`);
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { listar, detalle, rutaFotoReceta, validarReceta, cambiarEstatus, entregar, cancelar };
