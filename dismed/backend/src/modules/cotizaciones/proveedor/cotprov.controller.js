const { pool } = require('../../../config/db');

/**
 * Inicia cotizaciones a los proveedores seleccionados.
 * Body: {
 *   solicitud_id,
 *   proveedor_ids: [1, 2],
 *   partida_ids: [3, 5, 7]   ← opcional; null/ausente = todas las partidas
 * }
 */
async function iniciar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { solicitud_id, proveedor_ids, partida_ids } = req.body;
    if (!solicitud_id || !Array.isArray(proveedor_ids) || !proveedor_ids.length) {
      return res.status(400).json({ error: 'solicitud_id y proveedor_ids[] requeridos' });
    }

    // partida_ids null/vacío = incluir todas
    const filtrarPartidas = Array.isArray(partida_ids) && partida_ids.length > 0;
    const partidasJson = filtrarPartidas ? JSON.stringify(partida_ids) : null;

    const insertados = [];
    for (const pid of proveedor_ids) {
      const [r] = await conn.query(
        `INSERT IGNORE INTO cotizaciones_proveedor
           (solicitud_id, proveedor_id, estatus, partidas_json)
         VALUES (?, ?, 'solicitada', ?)`,
        [solicitud_id, pid, partidasJson]
      );
      if (r.insertId) insertados.push({ id: r.insertId, proveedor_id: pid });
    }

    // Datos para generar el mensaje de solicitud
    const [[sol]] = await conn.query(
      `SELECT s.folio, s.referencia_cliente, c.razon_social AS cliente
       FROM solicitudes s JOIN clientes c ON c.id = s.cliente_id
       WHERE s.id = ?`,
      [solicitud_id]
    );

    // Partidas a incluir en el mensaje
    let partidas;
    if (filtrarPartidas) {
      [partidas] = await conn.query(
        `SELECT linea, codigo_cliente, descripcion_original, cantidad, unidad_medida, observaciones
         FROM solicitudes_partidas
         WHERE solicitud_id = ? AND id IN (?)
         ORDER BY linea`,
        [solicitud_id, partida_ids]
      );
    } else {
      [partidas] = await conn.query(
        `SELECT linea, codigo_cliente, descripcion_original, cantidad, unidad_medida, observaciones
         FROM solicitudes_partidas WHERE solicitud_id = ? ORDER BY linea`,
        [solicitud_id]
      );
    }

    await conn.commit();
    res.status(201).json({ insertados, solicitud: sol, partidas });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * Registra precios recibidos de un proveedor.
 * Body: { precios: [{ partida_id, sku_proveedor, descripcion_proveedor,
 *                     observaciones_proveedor, precio_unitario, disponible }] }
 */
async function registrarPrecios(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { precios } = req.body;
    if (!Array.isArray(precios)) return res.status(400).json({ error: 'precios[] requerido' });

    await conn.query(
      `UPDATE cotizaciones_proveedor
       SET estatus = 'recibida', fecha_respuesta = NOW()
       WHERE id = ?`,
      [req.params.id]
    );

    const [[cot]] = await conn.query(
      'SELECT proveedor_id FROM cotizaciones_proveedor WHERE id = ?', [req.params.id]
    );

    for (const p of precios) {
      await conn.query(
        `INSERT INTO cotizaciones_proveedor_precios
          (cotizacion_proveedor_id, partida_id, sku_proveedor, descripcion_proveedor,
           observaciones_proveedor, precio_unitario, disponible)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sku_proveedor           = VALUES(sku_proveedor),
           descripcion_proveedor   = VALUES(descripcion_proveedor),
           observaciones_proveedor = VALUES(observaciones_proveedor),
           precio_unitario         = VALUES(precio_unitario),
           disponible              = VALUES(disponible)`,
        [req.params.id, p.partida_id,
         p.sku_proveedor || null,
         p.descripcion_proveedor || null,
         p.observaciones_proveedor || null,
         p.disponible === false ? null : (parseFloat(p.precio_unitario) || null),
         p.disponible === false ? 0 : 1]
      );

      if (p.sku_proveedor && p.partida_id && cot) {
        const [[partida]] = await conn.query(
          'SELECT producto_id FROM solicitudes_partidas WHERE id = ?', [p.partida_id]
        );
        if (partida?.producto_id) {
          await conn.query(
            `INSERT INTO proveedores_skus
              (proveedor_id, sku_proveedor, descripcion_proveedor, producto_id,
               ultimo_precio, ultima_cotizacion)
             VALUES (?, ?, ?, ?, ?, CURDATE())
             ON DUPLICATE KEY UPDATE
               descripcion_proveedor = VALUES(descripcion_proveedor),
               producto_id           = VALUES(producto_id),
               ultimo_precio         = VALUES(ultimo_precio),
               ultima_cotizacion     = VALUES(ultima_cotizacion)`,
            [cot.proveedor_id, p.sku_proveedor, p.descripcion_proveedor || null,
             partida.producto_id, parseFloat(p.precio_unitario) || null]
          );
        }
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * Actualiza un precio individual directamente desde el comparador.
 * PATCH /cotizaciones-proveedor/:cpId/precios/:partidaId
 * Body: { precio_unitario, disponible, sku_proveedor, observaciones_proveedor }
 */
async function actualizarPrecioIndividual(req, res, next) {
  try {
    const { cpId, partidaId } = req.params;
    const { precio_unitario, disponible, sku_proveedor, observaciones_proveedor } = req.body;

    await pool.query(
      `INSERT INTO cotizaciones_proveedor_precios
        (cotizacion_proveedor_id, partida_id, precio_unitario, disponible,
         sku_proveedor, observaciones_proveedor)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         precio_unitario         = VALUES(precio_unitario),
         disponible              = VALUES(disponible),
         sku_proveedor           = VALUES(sku_proveedor),
         observaciones_proveedor = VALUES(observaciones_proveedor)`,
      [cpId, partidaId,
       disponible === false ? null : (parseFloat(precio_unitario) || null),
       disponible === false ? 0 : 1,
       sku_proveedor || null,
       observaciones_proveedor || null]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function bySolicitud(req, res, next) {
  try {
    const [cotizaciones] = await pool.query(
      `SELECT cp.id, cp.proveedor_id, p.nombre_empresa AS proveedor,
              cp.estatus, cp.fecha_solicitud, cp.fecha_respuesta,
              cp.partidas_json
       FROM cotizaciones_proveedor cp
       JOIN proveedores p ON p.id = cp.proveedor_id
       WHERE cp.solicitud_id = ?`,
      [req.params.solicitudId]
    );

    for (const cot of cotizaciones) {
      const [precios] = await pool.query(
        `SELECT cpp.*, sp.descripcion_original, sp.linea, sp.cantidad
         FROM cotizaciones_proveedor_precios cpp
         JOIN solicitudes_partidas sp ON sp.id = cpp.partida_id
         WHERE cpp.cotizacion_proveedor_id = ?
         ORDER BY sp.linea`,
        [cot.id]
      );
      cot.precios = precios;
      // Parsear JSON de partidas si existe
      if (cot.partidas_json && typeof cot.partidas_json === 'string') {
        cot.partidas_incluidas = JSON.parse(cot.partidas_json);
      } else {
        cot.partidas_incluidas = null; // null = todas
      }
    }

    res.json(cotizaciones);
  } catch (err) { next(err); }
}

async function calcularMejorPrecio(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [partidas] = await conn.query(
      'SELECT id FROM solicitudes_partidas WHERE solicitud_id = ?',
      [req.params.solicitudId]
    );

    for (const partida of partidas) {
      await conn.query(
        `UPDATE cotizaciones_proveedor_precios cpp
         JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
         SET cpp.es_mejor_precio = 0
         WHERE cpp.partida_id = ? AND cp.solicitud_id = ?`,
        [partida.id, req.params.solicitudId]
      );

      const [[mejor]] = await conn.query(
        `SELECT cpp.id
         FROM cotizaciones_proveedor_precios cpp
         JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
         WHERE cpp.partida_id = ? AND cp.solicitud_id = ?
           AND cpp.disponible = 1 AND cpp.precio_unitario IS NOT NULL
         ORDER BY cpp.precio_unitario ASC
         LIMIT 1`,
        [partida.id, req.params.solicitudId]
      );

      if (mejor) {
        await conn.query(
          'UPDATE cotizaciones_proveedor_precios SET es_mejor_precio = 1 WHERE id = ?',
          [mejor.id]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true, partidas_procesadas: partidas.length });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { iniciar, registrarPrecios, actualizarPrecioIndividual, bySolicitud, calcularMejorPrecio };
