const { pool } = require('../../config/db');
const { extraerFactura } = require('./extractor.factura');
const {
  buscarProveedorPorRfc, buscarOcAbiertasDeProveedor, resolverOcYPartidas, buscarCfdiPorUuidOFolio,
  extraerRfcDeNombreArchivo,
} = require('./matching');
const { ejecutarRecepcion } = require('../ventas/recepcion.service');

// Solo se auto-elige el almacén cuando no hay ambigüedad: exactamente uno activo.
// Con 0 o 2+ almacenes activos se manda a revisión manual (no se puede adivinar el destino).
async function almacenPorDefecto(conn) {
  const [almacenes] = await conn.query('SELECT id FROM almacenes WHERE activo = 1');
  if (almacenes.length === 1) return { id: almacenes[0].id, motivo: null };
  if (almacenes.length === 0) return { id: null, motivo: 'No hay almacenes activos configurados' };
  return { id: null, motivo: 'Hay varios almacenes activos; no se puede elegir automáticamente el destino de la recepción' };
}

async function registrarLog(conn, {
  tipo, origen, archivo_nombre, estado, recepcion_id = null,
  cfdi_uuid_detectado = null, proveedor_id = null, mensaje = null, detalle = null,
}) {
  await conn.query(
    `INSERT INTO ingestion_log
       (tipo, origen, archivo_nombre, estado, recepcion_id, cfdi_uuid_detectado, proveedor_id, mensaje, detalle_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [tipo, origen, archivo_nombre, estado, recepcion_id, cfdi_uuid_detectado, proveedor_id, mensaje,
     detalle ? JSON.stringify(detalle) : null]
  );
}

// Anota lote/caducidad extraídos en los conceptos del CFDI ya conocido, por descripción exacta.
// Es trazabilidad fiscal de mejor esfuerzo: si no hay match, el concepto se deja como está.
async function anotarCfdiConceptos(conn, { cfdiId, partidasExtraidas }) {
  const [conceptos] = await conn.query(
    'SELECT id, descripcion FROM cfdi_repositorio_conceptos WHERE comprobante_id = ?', [cfdiId]
  );
  for (const item of partidasExtraidas) {
    const match = conceptos.find(
      (c) => (c.descripcion || '').trim().toUpperCase() === (item.descripcion || '').trim().toUpperCase()
    );
    if (!match) continue;
    await conn.query(
      `UPDATE cfdi_repositorio_conceptos
       SET lote_extraido = ?, fecha_caducidad_extraida = ?,
           estado_lote = ?
       WHERE id = ?`,
      [item.numero_lote, item.fecha_caducidad, item.numero_lote ? 'integrado' : 'sin_control', match.id]
    );
  }
}

async function recibirFactura(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'archivo (PDF) requerido' });
  const origen = req.body.origen === 'carpeta' ? 'carpeta' : 'correo';
  const conn = await pool.getConnection();
  try {
    const extraido = await extraerFactura(req.file.path);

    let proveedor = await buscarProveedorPorRfc(conn, extraido.rfc_emisor);
    // Fallback: si el RFC no se leyó del texto (p.ej. viene como imagen en el PDF),
    // varios proveedores lo ponen al inicio del nombre del archivo original.
    if (!proveedor) {
      const rfcArchivo = extraerRfcDeNombreArchivo(req.file.originalname);
      if (rfcArchivo) {
        proveedor = await buscarProveedorPorRfc(conn, rfcArchivo);
        if (proveedor) extraido.rfc_emisor = rfcArchivo;
      }
    }
    if (!proveedor) {
      const mensaje = `Proveedor no encontrado para RFC ${extraido.rfc_emisor || '(vacío)'}`;
      await registrarLog(conn, {
        tipo: 'factura', origen, archivo_nombre: req.file.originalname,
        estado: 'revision_manual', mensaje, detalle: extraido,
      });
      return res.json({ estado: 'revision_manual', detalle: mensaje });
    }

    const ocsCandidatas = await buscarOcAbiertasDeProveedor(conn, proveedor.id);
    const resultado = await resolverOcYPartidas(conn, {
      proveedor_id: proveedor.id, ocsCandidatas, partidasPdf: extraido.partidas,
    });

    let recepcionId = null;
    let estado = 'revision_manual';
    let mensaje = resultado.ok ? null : resultado.motivo;

    if (resultado.ok) {
      const almacen = await almacenPorDefecto(conn);
      if (!almacen.id) {
        mensaje = almacen.motivo;
      } else {
        await conn.beginTransaction();
        try {
          // Completa el vínculo producto_id que faltaba en la OC/pedido (ver matching.js:
          // vincular_oc), usando el código ya resuelto y confirmado de la factura — así el
          // usuario no tiene que vincular a mano la OC además del catálogo del proveedor.
          for (const e of resultado.emparejadas) {
            if (!e.vincular_oc) continue;
            const [[prod]] = await conn.query('SELECT sku_interno FROM productos WHERE id = ?', [e.producto_id]);
            await conn.query(
              'UPDATE ordenes_compra_partidas SET producto_id = ?, sku_interno = COALESCE(sku_interno, ?) WHERE id = ?',
              [e.producto_id, prod?.sku_interno || null, e.oc_partida_id]
            );
            if (e.pedido_partida_id) {
              await conn.query(
                'UPDATE pedidos_cliente_partidas SET producto_id = ?, sku_interno = COALESCE(sku_interno, ?) WHERE id = ?',
                [e.producto_id, prod?.sku_interno || null, e.pedido_partida_id]
              );
            }
          }

          const rec = await ejecutarRecepcion(conn, {
            oc_id: resultado.oc.id, almacen_id: almacen.id,
            partidas: resultado.emparejadas, usuario_id: null,
          });
          await conn.commit();
          recepcionId = rec.recepcion_id;
          estado = 'procesado';
        } catch (e) {
          await conn.rollback();
          mensaje = e.message;
        }
      }
    }

    // Trazabilidad fiscal (mejor esfuerzo, no bloquea la recepción anterior).
    const cfdi = await buscarCfdiPorUuidOFolio(conn, {
      uuid: extraido.uuid, rfc_emisor: extraido.rfc_emisor, folio: extraido.folio,
    });
    if (cfdi) await anotarCfdiConceptos(conn, { cfdiId: cfdi.id, partidasExtraidas: extraido.partidas });

    await registrarLog(conn, {
      tipo: 'factura', origen, archivo_nombre: req.file.originalname, estado,
      recepcion_id: recepcionId, cfdi_uuid_detectado: extraido.uuid, proveedor_id: proveedor.id,
      mensaje, detalle: extraido,
    });

    res.json({ estado, detalle: mensaje || 'Recepción automática generada', recepcion_id: recepcionId });
  } catch (err) {
    try {
      await registrarLog(conn, {
        tipo: 'factura', origen, archivo_nombre: req.file?.originalname || 'desconocido',
        estado: 'error', mensaje: err.message,
      });
    } catch (_e) { /* no bloquear la respuesta de error por un fallo de bitácora */ }
    next(err);
  } finally {
    conn.release();
  }
}

async function recibirPago(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'archivo (PDF) requerido' });
  const origen = req.body.origen === 'carpeta' ? 'carpeta' : 'correo';
  const conn = await pool.getConnection();
  try {
    // Comprobantes de pago: sin extracción de campos de negocio (alcance confirmado 2026-07-01).
    // Solo se intenta vincular a una factura si n8n manda una referencia explícita (UUID/folio
    // detectado en el asunto del correo o el nombre del archivo); si no, queda sin_vincular.
    const referencia = (req.body.referencia_factura || '').trim();
    let cfdiId = null;
    if (referencia) {
      const cfdi = await buscarCfdiPorUuidOFolio(conn, { uuid: referencia, rfc_emisor: null, folio: null });
      cfdiId = cfdi ? cfdi.id : null;
    }
    await conn.query(
      `INSERT INTO pagos_comprobantes (cfdi_repositorio_id, archivo_nombre, archivo_path, estado, origen)
       VALUES (?,?,?,?,?)`,
      [cfdiId, req.file.originalname, req.file.path, cfdiId ? 'vinculado' : 'sin_vincular', origen]
    );
    const estado = cfdiId ? 'procesado' : 'revision_manual';
    await registrarLog(conn, {
      tipo: 'pago', origen, archivo_nombre: req.file.originalname, estado,
      mensaje: cfdiId ? null : 'No se pudo vincular a una factura automáticamente',
    });
    res.json({ estado });
  } catch (err) { next(err); } finally { conn.release(); }
}

async function pendientes(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, tipo, origen, archivo_nombre, estado, mensaje, created_at
       FROM ingestion_log WHERE estado != 'procesado' ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ pendientes: rows });
  } catch (err) { next(err); }
}

module.exports = { recibirFactura, recibirPago, pendientes };
