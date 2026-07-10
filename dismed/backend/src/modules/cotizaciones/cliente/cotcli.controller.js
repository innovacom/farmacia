const { pool } = require('../../../config/db');
const { generarPdfCotizacion } = require('./pdf.generator');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT cc.id, cc.folio, cc.concepto, cc.estatus, cc.total, cc.created_at,
              c.razon_social AS cliente,
              s.folio AS folio_solicitud
       FROM cotizaciones_cliente cc
       JOIN clientes c ON c.id = cc.cliente_id
       JOIN solicitudes s ON s.id = cc.solicitud_id
       ORDER BY cc.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[cot]] = await pool.query(
      `SELECT cc.*,
              c.razon_social AS cliente_razon_social, c.rfc AS cliente_rfc,
              s.folio AS folio_solicitud, s.referencia_cliente,
              ct.nombre AS contacto_nombre,
              u.nombre  AS elaboro_nombre, u.puesto AS elaboro_puesto,
              j.nombre  AS autoriza_nombre
       FROM cotizaciones_cliente cc
       JOIN  clientes c           ON c.id  = cc.cliente_id
       JOIN  solicitudes s        ON s.id  = cc.solicitud_id
       LEFT JOIN clientes_contactos ct ON ct.id = cc.contacto_id
       LEFT JOIN usuarios u       ON u.id  = cc.elaborado_por_id
       LEFT JOIN usuarios j       ON j.id  = u.jefe_id
       WHERE cc.id = ?`,
      [req.params.id]
    );
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });

    const [partidas] = await pool.query(
      `SELECT ccp.*, p.sku_interno, p.iva_exento AS prod_iva_exento
       FROM cotizaciones_cliente_partidas ccp
       LEFT JOIN productos p ON p.id = ccp.producto_id
       WHERE ccp.cotizacion_id = ?
       ORDER BY ccp.linea`,
      [req.params.id]
    );

    res.json({ ...cot, partidas });
  } catch (err) { next(err); }
}

/**
 * Crea una cotización al cliente a partir del comparador.
 * Body: {
 *   solicitud_id, concepto, contacto_id,
 *   partidas: [{ partida_solicitud_id, producto_id, descripcion, cantidad, unidad_medida,
 *                precio_compra, margen_pct, codigo_cliente, sku_interno,
 *                observaciones, iva_exento }],
 *   condicion_pago, dias_credito, dias_vigencia, tiempo_entrega, notas
 * }
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      solicitud_id, concepto, atencion, contacto_id, partidas,
      condicion_pago, dias_credito, dias_vigencia, tiempo_entrega, notas,
    } = req.body;

    if (!solicitud_id || !Array.isArray(partidas) || !partidas.length) {
      return res.status(400).json({ error: 'solicitud_id y partidas[] requeridos' });
    }

    const [[sol]] = await conn.query(
      'SELECT cliente_id, atencion, concepto FROM solicitudes WHERE id = ?', [solicitud_id]
    );
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

    // Si no vienen en el body, heredar de la solicitud
    const conceptoFinal = concepto || sol.concepto || null;
    const atencionFinal = atencion || sol.atencion || null;

    // Calcular partidas — IVA ya no va en subtotal/iva del header (se calcula por línea)
    let subtotal = 0;
    const partidasCalc = partidas.map((p, i) => {
      const margen      = parseFloat(p.margen_pct)    || 0;
      const precioCompra = parseFloat(p.precio_compra) || 0;
      const precioVenta  = precioCompra * (1 + margen / 100);
      const importe      = precioVenta * parseFloat(p.cantidad);
      subtotal += importe;
      return { ...p, linea: p.linea ?? (i + 1), precio_compra: precioCompra,
               precio_unitario_venta: precioVenta, importe };
    });

    // Calcular IVA global respetando exenciones por línea
    const ivaTotal = partidasCalc.reduce((acc, p) => {
      const exento = p.iva_exento ? 1 : 0;
      return acc + (exento ? 0 : p.importe * 0.16);
    }, 0);
    const total = subtotal + ivaTotal;

    await conn.query('CALL sp_generar_folio(?, @folio)', ['COT']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const [r] = await conn.query(
      `INSERT INTO cotizaciones_cliente
        (folio, concepto, atencion, solicitud_id, cliente_id, contacto_id, elaborado_por_id,
         subtotal, iva, total,
         condicion_pago, dias_credito, dias_vigencia, tiempo_entrega, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, conceptoFinal, atencionFinal, solicitud_id, sol.cliente_id,
       contacto_id || null, req.user?.id || null,
       subtotal.toFixed(2), ivaTotal.toFixed(2), total.toFixed(2),
       condicion_pago || 'Contado', dias_credito || 0,
       dias_vigencia || 30, tiempo_entrega || '3 a 5 días hábiles', notas || null]
    );

    const cotId = r.insertId;

    for (const p of partidasCalc) {
      await conn.query(
        `INSERT INTO cotizaciones_cliente_partidas
          (cotizacion_id, partida_solicitud_id, producto_id, sku_interno, codigo_cliente,
           linea, descripcion, cantidad, unidad_medida,
           precio_compra, margen_pct, precio_unitario_venta, importe,
           observaciones, iva_exento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cotId, p.partida_solicitud_id || null, p.producto_id || null,
         p.sku_interno || null, p.codigo_cliente || null,
         p.linea, p.descripcion, p.cantidad, p.unidad_medida || 'pza',
         p.precio_compra.toFixed(2), p.margen_pct,
         p.precio_unitario_venta.toFixed(2), p.importe.toFixed(2),
         p.observaciones || null, p.iva_exento ? 1 : 0]
      );
    }

    await conn.query(
      "UPDATE solicitudes SET estatus = 'cotizada' WHERE id = ?", [solicitud_id]
    );

    await conn.commit();
    res.status(201).json({ id: cotId, folio, subtotal, iva: ivaTotal, total });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  try {
    const fields = ['concepto','atencion','condicion_pago','contacto_id',
                    'dias_credito','dias_vigencia','tiempo_entrega','notas'];
    const sets = []; const vals = [];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE cotizaciones_cliente SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function cambiarEstatus(req, res, next) {
  try {
    const { estatus } = req.body;
    const allowed = ['borrador','enviada','aceptada','rechazada','vencida'];
    if (!allowed.includes(estatus)) return res.status(400).json({ error: 'estatus inválido' });
    await pool.query('UPDATE cotizaciones_cliente SET estatus = ? WHERE id = ?',
      [estatus, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function generarPdf(req, res, next) {
  try {
    const [[cot]] = await pool.query(
      `SELECT cc.*,
              c.razon_social AS cliente_razon_social, c.rfc AS cliente_rfc,
              s.referencia_cliente,
              ct.nombre AS contacto_nombre,
              u.nombre  AS elaboro_nombre,
              j.nombre  AS autoriza_nombre
       FROM cotizaciones_cliente cc
       JOIN  clientes c             ON c.id  = cc.cliente_id
       JOIN  solicitudes s          ON s.id  = cc.solicitud_id
       LEFT JOIN clientes_contactos ct  ON ct.id = cc.contacto_id
       LEFT JOIN usuarios u         ON u.id  = cc.elaborado_por_id
       LEFT JOIN usuarios j         ON j.id  = u.jefe_id
       WHERE cc.id = ?`,
      [req.params.id]
    );
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });

    const [partidas] = await pool.query(
      `SELECT ccp.*,
              COALESCE(ccp.iva_exento, p.iva_exento, 0) AS iva_exento
       FROM cotizaciones_cliente_partidas ccp
       LEFT JOIN productos p ON p.id = ccp.producto_id
       WHERE ccp.cotizacion_id = ?
       ORDER BY ccp.linea`,
      [req.params.id]
    );

    cot.partidas       = partidas;
    cot.coc            = cot.referencia_cliente;
    cot.representante_legal = process.env.EMPRESA_REP_LEGAL || '';

    // Fallback: si no hay elaborador registrado, usar el usuario del token
    if (!cot.elaboro_nombre) cot.elaboro_nombre = req.user?.nombre;
    if (!cot.autoriza_nombre) cot.autoriza_nombre = req.user?.jefe_nombre || '';

    const { relativePath, filename } = await generarPdfCotizacion(cot);

    await pool.query('UPDATE cotizaciones_cliente SET pdf_path = ? WHERE id = ?',
      [relativePath, req.params.id]);

    res.json({ url: `${process.env.BASE_URL}${relativePath}`, filename });
  } catch (err) { next(err); }
}

async function convertirPedido(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cot]] = await conn.query(
      'SELECT * FROM cotizaciones_cliente WHERE id = ? AND estatus = ?',
      [req.params.id, 'aceptada']
    );
    if (!cot) return res.status(400).json({ error: 'La cotización debe estar en estatus "aceptada"' });

    await conn.query('CALL sp_generar_folio(?, @folio)', ['PED']);
    const [[{ folio }]] = await conn.query('SELECT @folio AS folio');

    const { tipo_pago, fecha_entrega_prom, notas } = req.body;
    const [r] = await conn.query(
      `INSERT INTO pedidos (folio, cotizacion_id, cliente_id, tipo_pago, fecha_entrega_prom, notas)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [folio, req.params.id, cot.cliente_id,
       tipo_pago || 'contado', fecha_entrega_prom || null, notas || null]
    );

    await conn.query(
      "UPDATE solicitudes SET estatus = 'pedido' WHERE id = ?", [cot.solicitud_id]
    );

    await conn.commit();
    res.status(201).json({ id: r.insertId, folio });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { list, getById, create, update, cambiarEstatus, generarPdf, convertirPedido };
