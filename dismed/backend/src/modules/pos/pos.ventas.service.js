/**
 * pos.ventas.service.js — Venta de mostrador.
 * Transacción central: valida turno abierto, receta para controlados, pagos;
 * inserta venta + partidas (snapshots) y descuenta inventario vía
 * registrarSalidaFEFO (restringido al almacén de la sucursal).
 * Reglas:
 *  - Idempotencia por client_uuid: un reintento devuelve la venta ya creada.
 *  - Controlado (clasificación ≠ libre/venta_farmacia) sin receta → 422; el
 *    backend es la fuente de verdad, no la UI.
 *  - Stock insuficiente → 409 con lo disponible; el mostrador nunca vende
 *    en negativo ni ajusta nada solo.
 */
const { pool } = require('../../config/db');
const inv = require('../inventario/movimientos.service');
const { getScoped } = require('./pos.tenant.helpers');

const CLASIF_LIBRES = ['libre', 'venta_farmacia'];

async function buscarProductos(empresaId, { q, sucursal_id }) {
  const conn = await pool.getConnection();
  try {
    const suc = await getScoped(conn, 'sucursales', sucursal_id, empresaId);
    const texto = (q || '').trim();
    if (!texto) return [];

    const base = `
      SELECT p.id, p.sku_interno, p.descripcion, p.ean, p.precio_publico,
             p.clasificacion_cofepris, p.control_lote_caducidad,
             COALESCE((SELECT SUM(l.cantidad_actual) FROM inventario_lotes l
                       WHERE l.producto_id = p.id AND l.almacen_id = ?), 0) AS existencia
      FROM productos p
      WHERE p.activo = 1 AND `;

    // 1º match exacto por EAN (lector de código de barras) o SKU
    const [exactos] = await conn.query(
      base + '(p.ean = ? OR p.sku_interno = ?) LIMIT 5',
      [suc.almacen_id, texto, texto]
    );
    if (exactos.length) return exactos.map((r) => ({ ...r, match: 'exacto' }));

    // 2º búsqueda por texto en descripción / SKU
    const like = `%${texto}%`;
    const [parecidos] = await conn.query(
      base + '(p.descripcion LIKE ? OR p.sku_interno LIKE ?) ORDER BY p.descripcion LIMIT 15',
      [suc.almacen_id, like, like]
    );
    return parecidos.map((r) => ({ ...r, match: 'texto' }));
  } finally {
    conn.release();
  }
}

async function cargarVenta(conn, empresaId, ventaId) {
  const venta = await getScoped(conn, 'pos_ventas', ventaId, empresaId);
  const [partidas] = await conn.query(
    `SELECT pp.*, r.folio_receta, r.paciente_nombre, m.nombre AS medico, m.cedula_profesional
     FROM pos_ventas_partidas pp
     LEFT JOIN pos_recetas r ON r.id = pp.receta_id
     LEFT JOIN medicos m ON m.id = r.medico_id
     WHERE pp.venta_id = ?`,
    [ventaId]
  );
  const [[extra]] = await conn.query(
    `SELECT s.nombre AS sucursal, s.direccion AS sucursal_direccion, c.nombre AS caja, u.nombre AS cajero
     FROM pos_ventas v
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN pos_cajas c ON c.id = v.caja_id
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE v.id = ?`,
    [ventaId]
  );
  return { ...venta, ...extra, partidas };
}

async function crearVenta(empresaId, payload) {
  const {
    client_uuid = null, turno_id, partidas = [], pagos = {}, receta = null, usuario_id,
  } = payload;

  // Idempotencia: si el uuid ya existe, devolver la venta original.
  if (client_uuid) {
    const [[ya]] = await pool.query(
      'SELECT id FROM pos_ventas WHERE client_uuid = ? AND empresa_id = ?',
      [client_uuid, empresaId]
    );
    if (ya) {
      const conn = await pool.getConnection();
      try { return { venta: await cargarVenta(conn, empresaId, ya.id), repetida: true }; }
      finally { conn.release(); }
    }
  }

  if (!Array.isArray(partidas) || !partidas.length) {
    throw Object.assign(new Error('La venta no tiene partidas'), { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Turno abierto y pertenencia del tenant; de la sucursal sale el almacén.
    const turno = await getScoped(conn, 'pos_turnos', turno_id, empresaId, { forUpdate: true });
    if (turno.estatus !== 'abierto') {
      throw Object.assign(new Error('El turno está cerrado; abre un turno para vender'), { status: 409 });
    }
    const caja = await getScoped(conn, 'pos_cajas', turno.caja_id, empresaId);
    const sucursal = await getScoped(conn, 'sucursales', caja.sucursal_id, empresaId);

    // Validar partidas contra el catálogo (snapshot de precio/clasificación).
    let subtotal = 0; let iva = 0;
    const partidasValidadas = [];
    const requierenReceta = [];
    for (const p of partidas) {
      const cantidad = Number(p.cantidad);
      if (!(cantidad > 0)) {
        throw Object.assign(new Error('Cantidad inválida en una partida'), { status: 400 });
      }
      const [[prod]] = await conn.query(
        `SELECT id, descripcion, precio_publico, clasificacion_cofepris, ieps
         FROM productos WHERE id = ? AND activo = 1`,
        [p.producto_id]
      );
      if (!prod) {
        throw Object.assign(new Error(`Producto ${p.producto_id} no existe o está inactivo`), { status: 400 });
      }
      const precio = Number(p.precio_unitario ?? prod.precio_publico);
      if (!(precio > 0)) {
        throw Object.assign(new Error(`El producto "${prod.descripcion}" no tiene precio público`), { status: 400 });
      }
      const descuento = Number(p.descuento || 0);
      const importe = Math.round((cantidad * precio - descuento) * 100) / 100;
      if (importe < 0) {
        throw Object.assign(new Error('Descuento mayor que el importe'), { status: 400 });
      }
      const ivaTasa = 0.16; // medicamentos tasa 0 se modelará con clave SAT en E4; MVP: IVA incluido en precio público
      // El precio público ya incluye IVA: se desglosa para el ticket.
      const importeSinIva = Math.round((importe / (1 + ivaTasa)) * 100) / 100;
      subtotal += importeSinIva;
      iva += importe - importeSinIva;

      if (!CLASIF_LIBRES.includes(prod.clasificacion_cofepris)) {
        requierenReceta.push(prod.descripcion);
      }
      partidasValidadas.push({
        producto_id: prod.id,
        descripcion: prod.descripcion,
        cantidad,
        precio_unitario: precio,
        descuento,
        iva_tasa: ivaTasa,
        importe,
        clasificacion_cofepris: prod.clasificacion_cofepris,
      });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    iva = Math.round(iva * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    // Controlados: sin receta no hay venta (el server es la fuente de verdad).
    if (requierenReceta.length && !receta) {
      throw Object.assign(
        new Error('Estos productos requieren receta médica'),
        { status: 422, productos: requierenReceta }
      );
    }

    // Pagos: efectivo + tarjeta >= total; la tarjeta nunca excede el total.
    const efectivo = Math.round(Number(pagos.efectivo || 0) * 100) / 100;
    const tarjeta = Math.round(Number(pagos.tarjeta || 0) * 100) / 100;
    if (efectivo < 0 || tarjeta < 0) {
      throw Object.assign(new Error('Pagos inválidos'), { status: 400 });
    }
    if (tarjeta > total) {
      throw Object.assign(new Error('El pago con tarjeta excede el total'), { status: 400 });
    }
    if (efectivo + tarjeta < total) {
      throw Object.assign(new Error('El pago no cubre el total'), { status: 400 });
    }
    const cambio = Math.round((efectivo - (total - tarjeta)) * 100) / 100;

    // Receta (si aplica): upsert de médico por (empresa, cédula) + registro.
    let recetaId = null;
    if (receta) {
      let medicoId = receta.medico_id || null;
      if (!medicoId && receta.medico_nuevo) {
        const mn = receta.medico_nuevo;
        if (!mn.nombre?.trim() || !mn.cedula_profesional?.trim()) {
          throw Object.assign(new Error('El médico requiere nombre y cédula profesional'), { status: 400 });
        }
        const [[existente]] = await conn.query(
          'SELECT id FROM medicos WHERE empresa_id = ? AND cedula_profesional = ?',
          [empresaId, mn.cedula_profesional.trim()]
        );
        if (existente) {
          medicoId = existente.id;
        } else {
          const [rm] = await conn.query(
            `INSERT INTO medicos (empresa_id, nombre, cedula_profesional, especialidad, institucion, telefono)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [empresaId, mn.nombre.trim(), mn.cedula_profesional.trim(),
             mn.especialidad || null, mn.institucion || null, mn.telefono || null]
          );
          medicoId = rm.insertId;
        }
      }
      if (!medicoId) {
        throw Object.assign(new Error('La receta requiere médico'), { status: 400 });
      }
      await getScoped(conn, 'medicos', medicoId, empresaId);
      if (!receta.paciente_nombre?.trim()) {
        throw Object.assign(new Error('La receta requiere nombre del paciente'), { status: 400 });
      }
      const [rr] = await conn.query(
        `INSERT INTO pos_recetas
           (empresa_id, folio_receta, medico_id, paciente_nombre, paciente_domicilio,
            fecha_receta, retenida, surtimiento, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, receta.folio_receta || null, medicoId, receta.paciente_nombre.trim(),
         receta.paciente_domicilio || null, receta.fecha_receta || new Date(),
         receta.retenida ? 1 : 0, receta.surtimiento || 1, usuario_id]
      );
      recetaId = rr.insertId;
    }

    // Folio + encabezado de la venta.
    const folio = await inv.genFolio(conn, 'POS');
    const [rv] = await conn.query(
      `INSERT INTO pos_ventas
         (empresa_id, sucursal_id, caja_id, turno_id, folio, client_uuid, cliente_id,
          subtotal, descuento, iva, total, pago_efectivo, pago_tarjeta, cambio, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [empresaId, sucursal.id, caja.id, turno.id, folio, client_uuid, payload.cliente_id || null,
       subtotal, iva, total, efectivo, tarjeta, cambio, usuario_id]
    );
    const ventaId = rv.insertId;
    if (recetaId) {
      await conn.query('UPDATE pos_recetas SET venta_id = ? WHERE id = ?', [ventaId, recetaId]);
    }

    // Partidas + salida FEFO restringida al almacén de la sucursal.
    for (const p of partidasValidadas) {
      let salida;
      try {
        salida = await inv.registrarSalidaFEFO(conn, {
          producto_id: p.producto_id,
          cantidad: p.cantidad,
          motivo: 'venta_pos',
          referencia: folio,
          usuario_id,
          almacen_id: sucursal.almacen_id,
        });
      } catch (e) {
        if (e.status === 400 && e.disponible !== undefined) {
          throw Object.assign(
            new Error(`Existencia insuficiente de "${p.descripcion}" en ${sucursal.nombre}`),
            { status: 409, producto: p.descripcion, disponible: e.disponible }
          );
        }
        throw e;
      }
      await conn.query(
        `INSERT INTO pos_ventas_partidas
           (empresa_id, venta_id, producto_id, descripcion, cantidad, precio_unitario,
            descuento, iva_tasa, importe, clasificacion_cofepris, receta_id, lotes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, ventaId, p.producto_id, p.descripcion, p.cantidad, p.precio_unitario,
         p.descuento, p.iva_tasa, p.importe, p.clasificacion_cofepris,
         CLASIF_LIBRES.includes(p.clasificacion_cofepris) ? null : recetaId,
         JSON.stringify(salida.lotes)]
      );
    }

    await conn.commit();
    return { venta: await cargarVenta(conn, empresaId, ventaId), repetida: false };
  } catch (err) {
    await conn.rollback();
    // Carrera sobre el mismo client_uuid: el UNIQUE es el respaldo.
    if (err.code === 'ER_DUP_ENTRY' && client_uuid) {
      const [[ya]] = await pool.query(
        'SELECT id FROM pos_ventas WHERE client_uuid = ? AND empresa_id = ?',
        [client_uuid, empresaId]
      );
      if (ya) {
        const c2 = await pool.getConnection();
        try { return { venta: await cargarVenta(c2, empresaId, ya.id), repetida: true }; }
        finally { c2.release(); }
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Cancela una venta SOLO si su turno sigue abierto y no tiene CFDI:
 * reingresa el inventario (entrada por lote consumido) y marca 'cancelada'.
 * Fuera de esas condiciones → 409 (se resuelve manualmente; nota de crédito
 * queda para Fase 2 — nunca se fuerza).
 */
async function cancelarVenta(empresaId, ventaId, { motivo, usuario_id }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const venta = await getScoped(conn, 'pos_ventas', ventaId, empresaId, { forUpdate: true });
    if (venta.estatus !== 'completada') {
      throw Object.assign(new Error('La venta ya está cancelada'), { status: 409 });
    }
    if (venta.factura_estado !== 'sin_factura' || venta.cfdi_id) {
      throw Object.assign(new Error('La venta ya tiene factura; se resuelve con nota de crédito (manual)'), { status: 409 });
    }
    const turno = await getScoped(conn, 'pos_turnos', venta.turno_id, empresaId);
    if (turno.estatus !== 'abierto') {
      throw Object.assign(new Error('El turno de la venta ya cerró; la cancelación es un proceso manual'), { status: 409 });
    }

    const sucursal = await getScoped(conn, 'sucursales', venta.sucursal_id, empresaId);
    const [partidas] = await conn.query(
      'SELECT * FROM pos_ventas_partidas WHERE venta_id = ?', [ventaId]
    );
    // Reingreso por lote exacto (lo que salió, regresa).
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
          motivo: 'cancelacion_pos',
          referencia: venta.folio,
          usuario_id,
          permitir_sin_lote: true,
        });
      }
    }
    await conn.query(
      `UPDATE pos_ventas SET estatus = 'cancelada', cancelada_en = NOW(),
        cancelada_por = ?, motivo_cancelacion = ? WHERE id = ?`,
      [usuario_id, motivo || null, ventaId]
    );
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function detalleVenta(empresaId, ventaId) {
  const conn = await pool.getConnection();
  try { return await cargarVenta(conn, empresaId, ventaId); }
  finally { conn.release(); }
}

async function listarVentas(empresaId, { turno_id, desde, hasta, limit = 100 }) {
  const params = [empresaId];
  let where = 'v.empresa_id = ?';
  if (turno_id) { where += ' AND v.turno_id = ?'; params.push(turno_id); }
  if (desde) { where += ' AND v.created_at >= ?'; params.push(desde); }
  if (hasta) { where += ' AND v.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; params.push(hasta); }
  const [rows] = await pool.query(
    `SELECT v.id, v.folio, v.total, v.pago_efectivo, v.pago_tarjeta, v.cambio,
            v.estatus, v.factura_estado, v.created_at,
            s.nombre AS sucursal, c.nombre AS caja, u.nombre AS cajero
     FROM pos_ventas v
     JOIN sucursales s ON s.id = v.sucursal_id
     JOIN pos_cajas c ON c.id = v.caja_id
     JOIN usuarios u ON u.id = v.usuario_id
     WHERE ${where}
     ORDER BY v.id DESC
     LIMIT ${Number(limit) || 100}`,
    params
  );
  return rows;
}

module.exports = { buscarProductos, crearVenta, cancelarVenta, detalleVenta, listarVentas };
