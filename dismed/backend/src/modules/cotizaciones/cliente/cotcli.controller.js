const XLSX = require('xlsx');
const { pool } = require('../../../config/db');
const { generarPdfCotizacion } = require('./pdf.generator');
const { urlFirmada } = require('../../../services/outputUrl.service');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT cc.id, cc.folio, cc.concepto, cc.estatus, cc.total, cc.created_at,
              c.razon_social AS cliente, su.nombre AS sucursal,
              s.folio AS folio_solicitud
       FROM cotizaciones_cliente cc
       JOIN clientes c ON c.id = cc.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = cc.sucursal_id
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
              su.nombre AS sucursal_nombre, su.direccion_entrega AS sucursal_direccion,
              s.folio AS folio_solicitud, s.referencia_cliente,
              ct.nombre AS contacto_nombre,
              u.nombre  AS elaboro_nombre, u.puesto AS elaboro_puesto,
              j.nombre  AS autoriza_nombre
       FROM cotizaciones_cliente cc
       JOIN  clientes c           ON c.id  = cc.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = cc.sucursal_id
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
    const partidaInvalida = partidas.find((p) => !(parseFloat(p.cantidad) > 0));
    if (partidaInvalida) {
      return res.status(400).json({ error: `Cantidad inválida en la partida "${partidaInvalida.descripcion || partidaInvalida.linea || ''}": debe ser mayor a 0` });
    }

    const [[sol]] = await conn.query(
      'SELECT cliente_id, sucursal_id, atencion, concepto FROM solicitudes WHERE id = ?', [solicitud_id]
    );
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

    // Si no vienen en el body, heredar de la solicitud
    const conceptoFinal = concepto || sol.concepto || null;
    const atencionFinal = atencion || sol.atencion || null;

    // Precio de compra real por partida: el "mejor precio" ya calculado por
    // calcularMejorPrecio (fuente de verdad, viene de cotizaciones_proveedor_precios).
    // Antes se confiaba en partidas[i].precio_compra tal cual venía en el body,
    // que el cliente HTTP podía mandar con cualquier valor sin que el servidor
    // lo cruzara contra lo realmente cotizado por el proveedor.
    const [preciosReales] = await conn.query(
      `SELECT cpp.partida_id, cpp.precio_unitario
       FROM cotizaciones_proveedor_precios cpp
       JOIN cotizaciones_proveedor cp ON cp.id = cpp.cotizacion_proveedor_id
       WHERE cp.solicitud_id = ? AND cpp.es_mejor_precio = 1 AND cpp.disponible = 1`,
      [solicitud_id]
    );
    const precioRealPorPartida = new Map(
      preciosReales.map((r) => [r.partida_id, parseFloat(r.precio_unitario) || 0])
    );

    // Calcular partidas — IVA ya no va en subtotal/iva del header (se calcula por línea)
    let subtotal = 0;
    const partidasCalc = partidas.map((p, i) => {
      let margen        = parseFloat(p.margen_pct) || 0;
      // Sin mejor precio registrado (partida sin cotizar a proveedor), el
      // costo real es 0 — mismo comportamiento que ya tenía el frontend.
      const precioCompra = precioRealPorPartida.get(p.partida_solicitud_id) ?? 0;
      // Precio de venta exacto capturado por el usuario (override del margen)
      const precioFijo   = parseFloat(p.precio_venta);
      let precioVenta;
      if (Number.isFinite(precioFijo) && precioFijo > 0) {
        precioVenta = precioFijo;
        if (precioCompra > 0) margen = Math.round((precioVenta / precioCompra - 1) * 10000) / 100;
      } else {
        precioVenta = precioCompra * (1 + margen / 100);
      }
      const importe      = precioVenta * parseFloat(p.cantidad);
      subtotal += importe;
      return { ...p, margen_pct: margen, linea: p.linea ?? (i + 1), precio_compra: precioCompra,
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
        (folio, concepto, atencion, solicitud_id, cliente_id, sucursal_id, contacto_id, elaborado_por_id,
         subtotal, iva, total,
         condicion_pago, dias_credito, dias_vigencia, tiempo_entrega, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, conceptoFinal, atencionFinal, solicitud_id, sol.cliente_id, sol.sucursal_id || null,
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
              su.nombre AS sucursal_nombre, su.direccion_entrega AS sucursal_direccion,
              s.referencia_cliente,
              ct.nombre AS contacto_nombre,
              u.nombre  AS elaboro_nombre,
              j.nombre  AS autoriza_nombre
       FROM cotizaciones_cliente cc
       JOIN  clientes c             ON c.id  = cc.cliente_id
       LEFT JOIN clientes_sucursales su ON su.id = cc.sucursal_id
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

    res.json({ url: urlFirmada(relativePath, { absoluta: true }), filename });
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
      `INSERT INTO pedidos (folio, cotizacion_id, cliente_id, sucursal_id, tipo_pago, fecha_entrega_prom, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [folio, req.params.id, cot.cliente_id, cot.sucursal_id || null,
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

/**
 * GET /cotizaciones-cliente/:id/exportar-excel
 * Genera un xlsx con el mismo layout que el Excel de carga de solicitudes
 * (ver parser.excel.js: filas 1-4 metadatos + proveedores desde col Q,
 * fila 5 encabezados, fila 6+ partidas), pero a nivel partida agrega las
 * columnas de análisis de la cotización ya generada:
 *   G precio de compra ganador · H total de compra (cant × compra)
 *   I ganancia estimada (venta − compra) · J proveedor ganador
 *   K precio unitario de venta · L subtotal (venta × cant)
 *   M IVA del subtotal · N total (L + M)
 * Sirve para reenviar/archivar la cotización con el detalle de proveedores.
 */
async function exportarExcel(req, res, next) {
  try {
    const [[cot]] = await pool.query(
      `SELECT cc.*,
              c.razon_social AS cliente_nombre,
              s.folio AS folio_solicitud, s.referencia_cliente, s.factor_ganancia,
              u.nombre AS elaboro_nombre, j.nombre AS autoriza_nombre
       FROM cotizaciones_cliente cc
       JOIN clientes c        ON c.id = cc.cliente_id
       JOIN solicitudes s     ON s.id = cc.solicitud_id
       LEFT JOIN usuarios u   ON u.id = cc.elaborado_por_id
       LEFT JOIN usuarios j   ON j.id = u.jefe_id
       WHERE cc.id = ?`,
      [req.params.id]
    );
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });

    const [partidas] = await pool.query(
      `SELECT ccp.*, COALESCE(ccp.iva_exento, p.iva_exento, 0) AS iva_exento
       FROM cotizaciones_cliente_partidas ccp
       LEFT JOIN productos p ON p.id = ccp.producto_id
       WHERE ccp.cotizacion_id = ?
       ORDER BY ccp.linea`,
      [req.params.id]
    );

    // Precios de proveedores registrados para la solicitud de origen
    const [compRows] = await pool.query(
      'SELECT * FROM v_comparador_precios WHERE solicitud_id = ?',
      [cot.solicitud_id]
    );
    const proveedores = [...new Set(compRows.map((r) => r.proveedor).filter(Boolean))].sort();
    const preciosPorPartida = new Map();   // partida_solicitud_id -> { proveedor -> {precio, comentario, es_mejor} }
    for (const r of compRows) {
      if (!r.proveedor) continue;
      if (!preciosPorPartida.has(r.partida_id)) preciosPorPartida.set(r.partida_id, {});
      preciosPorPartida.get(r.partida_id)[r.proveedor] = {
        precio: r.precio_unitario,
        comentario: r.observaciones_proveedor,
        es_mejor: r.es_mejor_precio && r.disponible,
      };
    }

    const filaBase = () => new Array(16).fill('');
    const aoa = [];

    const f1 = filaBase();
    f1[1] = 'CLIENTE'; f1[2] = 'DIRIGIR A'; f1[4] = 'ELABORO'; f1[5] = 'AUTORIZO'; f1[6] = 'DESCRIPCION';
    aoa.push(f1);

    const f2 = filaBase();
    f2[1] = cot.cliente_nombre; f2[2] = cot.atencion || '';
    f2[4] = cot.elaboro_nombre || req.user?.nombre || '';
    f2[5] = cot.autoriza_nombre || req.user?.jefe_nombre || '';
    f2[6] = cot.concepto || '';
    aoa.push(f2);

    const f3 = filaBase();
    f3[0] = 'COC'; f3[1] = cot.referencia_cliente || '';
    aoa.push(f3);

    const f4 = filaBase();
    f4[5] = cot.factor_ganancia != null ? Number(cot.factor_ganancia) : '';
    proveedores.forEach((prov, i) => { f4[16 + i * 2] = prov; });
    aoa.push(f4);

    const f5 = filaBase();
    f5[0] = 'PARTIDA'; f5[1] = 'CODIGO'; f5[2] = 'CODIGO GOBIERNO'; f5[3] = 'CANTIDAD';
    f5[4] = 'UNIDAD'; f5[5] = 'DESCRIPCION';
    f5[6] = 'PRECIO COMPRA'; f5[7] = 'TOTAL COMPRA'; f5[8] = 'GANANCIA ESTIMADA';
    f5[9] = 'PROVEEDOR'; f5[10] = 'PRECIO VENTA'; f5[11] = 'SUBTOTAL'; f5[12] = 'IVA'; f5[13] = 'TOTAL';
    f5[14] = 'OBSERVACION INNOVACOM';
    proveedores.forEach((prov, i) => { f5[16 + i * 2] = prov; f5[17 + i * 2] = 'COMENTARIO'; });
    aoa.push(f5);

    for (const p of partidas) {
      const cantidad     = Number(p.cantidad) || 0;
      const precioCompra = Number(p.precio_compra) || 0;
      const precioVenta  = Number(p.precio_unitario_venta) || 0;
      const totalCompra  = precioCompra * cantidad;
      const subtotal     = Number(p.importe) || precioVenta * cantidad;
      const iva          = p.iva_exento ? 0 : subtotal * 0.16;
      const preciosProv  = preciosPorPartida.get(p.partida_solicitud_id) || {};
      const ganador      = Object.entries(preciosProv).find(([, v]) => v.es_mejor);

      const fila = filaBase();
      fila[0]  = p.linea;
      fila[1]  = p.codigo_cliente || '';
      fila[3]  = cantidad;
      fila[4]  = p.unidad_medida || '';
      fila[5]  = p.descripcion;
      fila[6]  = precioCompra;
      fila[7]  = totalCompra;
      fila[8]  = subtotal - totalCompra;
      fila[9]  = ganador ? ganador[0] : '';
      fila[10] = precioVenta;
      fila[11] = subtotal;
      fila[12] = iva;
      fila[13] = subtotal + iva;
      fila[14] = p.observaciones || '';
      proveedores.forEach((prov, i) => {
        const pr = preciosProv[prov];
        fila[16 + i * 2] = pr?.precio ?? '';
        fila[17 + i * 2] = pr?.comentario ?? '';
      });
      aoa.push(fila);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cotización');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cotizacion_${cot.folio}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, cambiarEstatus, generarPdf, convertirPedido, exportarExcel };
