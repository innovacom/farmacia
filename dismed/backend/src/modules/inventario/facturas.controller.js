/**
 * facturas.controller.js — Carga automática de facturas (CFDI XML de compra) al inventario.
 *
 * Flujo en dos pasos:
 *  1. preview: lee el XML (reutiliza cfdi.parser), valida que seamos el receptor, resuelve/da de
 *     alta el proveedor (por RFC) y cada producto (por sku_interno o ean del concepto). El alta de
 *     catálogo (proveedor/productos) SÍ se ejecuta aquí — es idempotente por RFC/EAN/SKU, así que
 *     subir el mismo XML dos veces no duplica nada. Lo único que NO se toca en este paso es el
 *     inventario (existencias).
 *  2. confirmar: con ubicación/lote/caducidad/cantidad ya capturados por el usuario, registra la
 *     entrada de inventario (movimientos.service.registrarEntrada) por cada renglón.
 */
const { pool } = require('../../config/db');
const fs = require('fs');
const { parseCfdi } = require('../cfdi/cfdi.parser');
const { normalizar } = require('../solicitudes/matcher');
const svc = require('./movimientos.service');
const { normalizarPrecioPublico, validarPrecios, tienePrecioLista, PRECIO_PUBLICO_SIN_TOPE } = require('../productos/productos.pricing');
const { resolverId } = require('../productos/taxonomia.util');
const { clasificarProductosNuevos } = require('../productos/clasificador.ia');

async function generarSku(conn) {
  await conn.query('CALL sp_generar_sku(@sku)');
  const [[{ sku }]] = await conn.query('SELECT @sku AS sku');
  return sku;
}

// Última ubicación usada por este producto en este almacén (si ya tiene existencias ahí).
async function ubicacionSugerida(conn, producto_id, almacen_id) {
  const [[row]] = await conn.query(
    `SELECT u.codigo FROM inventario_lotes il
     JOIN ubicaciones u ON u.id = il.ubicacion_id
     WHERE il.producto_id = ? AND il.almacen_id = ?
     ORDER BY il.id DESC LIMIT 1`,
    [producto_id, almacen_id]
  );
  return row ? row.codigo : null;
}

const PROD_COLS = 'id, sku_interno, control_lote_caducidad, vendible, clasificacion_cofepris, precio_lista, precio_publico';

// Resuelve TODOS los códigos de la factura en dos consultas (no 1-2 por
// renglón): prioridad sku_interno sobre ean, igual que la versión por-código.
async function buscarProductosPorCodigos(conn, codigos) {
  const porCodigo = new Map();
  if (!codigos.length) return porCodigo;
  const [rows] = await conn.query(
    `SELECT ${PROD_COLS}, ean FROM productos WHERE sku_interno IN (?) OR ean IN (?)`,
    [codigos, codigos]
  );
  const porSku = new Map(rows.filter((r) => codigos.includes(r.sku_interno)).map((r) => [r.sku_interno, r]));
  const porEan = new Map(rows.filter((r) => r.ean && codigos.includes(r.ean)).map((r) => [r.ean, r]));
  for (const codigo of codigos) {
    porCodigo.set(codigo, porSku.get(codigo) || porEan.get(codigo) || null);
  }
  return porCodigo;
}

async function preview(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'Archivo XML requerido' });
  const almacen_id = req.body.almacen_id;

  const limpiar = () => { try { fs.unlinkSync(req.file.path); } catch { /* noop */ } };

  if (!almacen_id) { limpiar(); return res.status(400).json({ error: 'almacen_id requerido' }); }

  let comprobante, conceptos;
  try {
    const xml = fs.readFileSync(req.file.path, 'utf8');
    ({ comprobante, conceptos } = parseCfdi(xml));
  } catch (e) {
    limpiar();
    return res.status(400).json({ error: 'El archivo no es un CFDI válido: ' + e.message });
  }
  limpiar();

  if (comprobante.tipo_comprobante !== 'I') {
    return res.status(400).json({ error: 'El CFDI debe ser de tipo Ingreso (factura de compra)' });
  }
  const rfcPropio = (process.env.EMPRESA_RFC || 'RIC1903041Q2').toUpperCase();
  if ((comprobante.rfc_receptor || '').toUpperCase() !== rfcPropio) {
    return res.status(400).json({
      error: `El receptor del CFDI (${comprobante.rfc_receptor || 'vacío'}) no coincide con nuestro RFC — no parece una factura de compra`,
    });
  }
  if ((comprobante.rfc_emisor || '').toUpperCase() === rfcPropio) {
    return res.status(400).json({ error: 'El emisor del CFDI somos nosotros mismos — sube una factura de un proveedor' });
  }
  if (!conceptos.length) {
    return res.status(400).json({ error: 'El CFDI no tiene conceptos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[provExist]] = await conn.query(
      'SELECT id, nombre_empresa, rfc FROM proveedores WHERE rfc = ?', [comprobante.rfc_emisor]
    );
    let proveedor;
    if (provExist) {
      proveedor = { ...provExist, _nuevo: false };
    } else {
      const nombre = comprobante.nombre_emisor || comprobante.rfc_emisor;
      const [r] = await conn.query(
        'INSERT INTO proveedores (nombre_empresa, rfc, dias_entrega_prom) VALUES (?, ?, 3)',
        [nombre, comprobante.rfc_emisor]
      );
      proveedor = { id: r.insertId, nombre_empresa: nombre, rfc: comprobante.rfc_emisor, _nuevo: true };
    }

    // Pre-resolución: se detecta primero qué conceptos NO matchean ningún producto
    // existente (por SKU/EAN), antes del loop que los da de alta, para poder mandar
    // todos los productos nuevos a clasificar por IA en un solo lote (en vez de una
    // llamada a Gemini por renglón, que sería mucho más lento y pegaría contra el
    // rate limit del free tier en facturas con muchos conceptos).
    const codigosPorConcepto = conceptos.map((c) => (c.no_identificacion || '').trim());
    const prodsPorCodigo = await buscarProductosPorCodigos(conn, [...new Set(codigosPorConcepto.filter(Boolean))]);
    const prodsExistentes = codigosPorConcepto.map((codigo) => prodsPorCodigo.get(codigo) || null);
    const idxNuevos = conceptos.map((_, i) => i).filter((i) => !prodsExistentes[i]);
    const clasifPorIndice = new Map();
    let sinClasificarIa = 0;
    if (idxNuevos.length) {
      const [familiasRows] = await conn.query('SELECT DISTINCT nombre FROM familias ORDER BY nombre');
      const familiasExistentes = familiasRows.map((f) => f.nombre);
      const paraClasificar = idxNuevos.map((i) => ({
        descripcion: conceptos[i].descripcion || '',
        clave_sat: conceptos[i].clave_prod_serv || '',
      }));
      const { resultados, noClasificados } = await clasificarProductosNuevos(paraClasificar, familiasExistentes);
      idxNuevos.forEach((i, j) => { if (resultados[j]) clasifPorIndice.set(i, resultados[j]); });
      sinClasificarIa = noClasificados;
    }

    const cacheTax = {};
    const renglones = [];
    let nuevosProductos = 0;
    for (let idx = 0; idx < conceptos.length; idx++) {
      const c = conceptos[idx];
      const codigo = codigosPorConcepto[idx];
      let prod = prodsExistentes[idx];
      let productoNuevo = false;

      if (!prod) {
        const sku = await generarSku(conn);
        const descripcion = c.descripcion || sku;
        const unidad = (c.unidad || '').trim() || 'pza';
        // IVA real del CFDI, no supuesto: TasaOCuota 0.000000 → iva_exento=1 (así lo usa
        // el POS: tasa 0 en medicamentos, NO exento legalmente, ver pos.ventas.service.js).
        const ivaExento = c.tasa_iva === 0 ? 1 : 0;

        // Clasificación automática por IA (familia/categoría/subcategoría + COFEPRIS):
        // el CFDI de compra no trae esta información, así que se intenta inferir de la
        // descripción para no dejar el producto sin taxonomía. Si la IA no está disponible
        // o no logra clasificarlo con confianza, sigue el flujo normal (sin taxonomía,
        // clasificacion_cofepris 'libre'), editable a mano en esta misma pantalla o en
        // Catálogo de productos — nunca bloquea el alta.
        const clasif = clasifPorIndice.get(idx);
        let familiaId = null, categoriaId = null, subcategoriaId = null;
        if (clasif && clasif.familia) {
          familiaId = await resolverId(conn, cacheTax, 'familias',
            ['nombre'], [clasif.familia], ['nombre'], [clasif.familia]);
          if (clasif.categoria) {
            categoriaId = await resolverId(conn, cacheTax, 'categorias_prod',
              ['familia_id', 'nombre'], [familiaId, clasif.categoria], ['familia_id', 'nombre'], [familiaId, clasif.categoria]);
            if (clasif.subcategoria) {
              subcategoriaId = await resolverId(conn, cacheTax, 'subcategorias_prod',
                ['categoria_id', 'nombre'], [categoriaId, clasif.subcategoria], ['categoria_id', 'nombre'], [categoriaId, clasif.subcategoria]);
            }
          }
        }
        const clasificacionCofepris = (clasif && clasif.clasificacion_cofepris) || 'libre';

        const [r] = await conn.query(
          `INSERT INTO productos
             (sku_interno, descripcion, descripcion_norm, unidad_medida, clave_sat, clave_unidad_sat,
              ean, precio_costo, control_lote_caducidad, vendible, iva_exento,
              familia_id, categoria_id, subcategoria_id, clasificacion_cofepris)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
          [sku, descripcion, normalizar(descripcion).substring(0, 800), unidad,
            c.clave_prod_serv || null, c.clave_unidad || null,
            codigo || null, c.valor_unitario ?? null, ivaExento,
            familiaId, categoriaId, subcategoriaId, clasificacionCofepris]
        );
        // Sin precio de venta capturado (el XML solo trae costo) → no vendible hasta que se
        // capture precio_lista/precio_publico (en esta misma pantalla o en Catálogo de productos).
        prod = {
          id: r.insertId, sku_interno: sku, control_lote_caducidad: 1, vendible: 0,
          clasificacion_cofepris: clasificacionCofepris,
        };
        productoNuevo = true;
        nuevosProductos++;
      }

      // Catálogo/tarifario del proveedor: se auto-llena con cada línea del CFDI —
      // da de alta el renglón si no existe, o actualiza precio/descripción si ya estaba.
      if (codigo) {
        await conn.query(
          `INSERT INTO proveedores_catalogo
             (proveedor_id, sku_proveedor, descripcion, unidad_medida, precio_lista, producto_id, match_estado, fecha_precio)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmado', CURDATE())
           ON DUPLICATE KEY UPDATE
             descripcion = VALUES(descripcion), unidad_medida = VALUES(unidad_medida),
             precio_lista = VALUES(precio_lista), producto_id = VALUES(producto_id),
             match_estado = 'confirmado', fecha_precio = CURDATE()`,
          [proveedor.id, codigo.slice(0, 40), (c.descripcion || '').slice(0, 800),
            (c.unidad || '').trim().slice(0, 20) || null, c.valor_unitario ?? null, prod.id]
        );
      }

      const ubicacion = await ubicacionSugerida(conn, prod.id, almacen_id);

      renglones.push({
        linea: c.linea,
        producto_id: prod.id,
        sku_interno: prod.sku_interno,
        descripcion: c.descripcion,
        codigo_proveedor: codigo || null,
        control_lote_caducidad: !!prod.control_lote_caducidad,
        producto_nuevo: productoNuevo,
        vendible: !!prod.vendible,
        // Solo se ofrece capturar/corregir la clasificación COFEPRIS de lo que esta pantalla
        // acaba de dar de alta — un producto preexistente ya se gestiona en Catálogo de productos.
        clasificacion_cofepris: productoNuevo ? (prod.clasificacion_cofepris || 'libre') : null,
        cantidad: c.cantidad,
        costo_unitario: c.valor_unitario,
        // Si el producto ya es vendible se sugiere su precio actual (editable, por si el
        // proveedor subió el costo y conviene ajustarlo aquí mismo); si es nuevo, vacío.
        precio_lista: prod.vendible && prod.precio_lista != null ? String(prod.precio_lista) : '',
        precio_publico: prod.vendible && prod.precio_publico != null && Number(prod.precio_publico) !== PRECIO_PUBLICO_SIN_TOPE
          ? String(prod.precio_publico) : '',
        ubicacion: ubicacion || '',
        numero_lote: '',
        fecha_caducidad: '',
      });
    }

    await conn.commit();

    res.json({
      comprobante: {
        uuid: comprobante.uuid, serie: comprobante.serie, folio: comprobante.folio,
        fecha: comprobante.fecha, total: comprobante.total,
      },
      proveedor,
      renglones,
      resumen: {
        total: renglones.length, nuevos_productos: nuevosProductos, proveedor_nuevo: proveedor._nuevo,
        sin_clasificar_ia: sinClasificarIa,
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function confirmar(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { almacen_id, proveedor_id, comprobante, renglones } = req.body;
    if (!almacen_id) return res.status(400).json({ error: 'almacen_id requerido' });
    if (!Array.isArray(renglones) || !renglones.length) return res.status(400).json({ error: 'renglones[] requerido' });

    await conn.beginTransaction();

    const ubicCache = {};
    async function ubicacionId(codigo) {
      const cod = (codigo || '').toString().trim().substring(0, 40);
      if (!cod) return null;
      if (ubicCache[cod]) return ubicCache[cod];
      const [[u]] = await conn.query('SELECT id FROM ubicaciones WHERE almacen_id = ? AND codigo = ?', [almacen_id, cod]);
      if (u) { ubicCache[cod] = u.id; return u.id; }
      const tipo = /anaquel/i.test(cod) ? 'anaquel' : (/^\d+$/.test(cod) ? 'tarima' : 'otro');
      const [r] = await conn.query('INSERT INTO ubicaciones (almacen_id, codigo, tipo) VALUES (?, ?, ?)', [almacen_id, cod, tipo]);
      ubicCache[cod] = r.insertId;
      return r.insertId;
    }

    const referencia = (comprobante?.folio
      ? `${comprobante.serie || ''}${comprobante.folio}`
      : comprobante?.uuid || 'FACTURA').toString().slice(0, 60);

    let importados = 0, omitidos = 0;
    const errores = [];
    const avisos = [];
    for (const r of renglones) {
      if (!r.producto_id || !(parseFloat(r.cantidad) > 0)) { omitidos++; continue; }

      // Precio/clasificación capturados en esta misma pantalla — se guardan ANTES de la
      // entrada para que el producto quede vendible de una vez, sin visitar el catálogo aparte.
      // No bloquea la recepción física si el precio no pasa la validación: la mercancía ya
      // llegó, solo queda avisado para corregirlo después.
      if (r.precio_lista !== undefined && r.precio_lista !== '') {
        const precioPublico = normalizarPrecioPublico(r.precio_publico);
        const errPrecio = validarPrecios(r.precio_lista, precioPublico);
        if (errPrecio) {
          avisos.push({ sku: r.sku_interno, motivo: `Precio no guardado: ${errPrecio}` });
        } else {
          const sets = ['precio_lista = ?', 'precio_publico = ?', 'vendible = ?'];
          const vals = [r.precio_lista, precioPublico, tienePrecioLista(r.precio_lista) ? 1 : 0];
          if (r.clasificacion_cofepris) { sets.push('clasificacion_cofepris = ?'); vals.push(r.clasificacion_cofepris); }
          vals.push(r.producto_id);
          await conn.query(`UPDATE productos SET ${sets.join(', ')} WHERE id = ?`, vals);
        }
      } else if (r.clasificacion_cofepris) {
        await conn.query('UPDATE productos SET clasificacion_cofepris = ? WHERE id = ?', [r.clasificacion_cofepris, r.producto_id]);
      }

      // El check "controla lote" de esta pantalla es la fuente de verdad al momento de recibir:
      // si el usuario lo desmarca, el producto queda marcado como sin control de lote/caducidad
      // (registrarEntrada usa este campo, ya actualizado, para decidir si exige numero_lote).
      if (r.control_lote_caducidad !== undefined) {
        await conn.query('UPDATE productos SET control_lote_caducidad = ? WHERE id = ?', [r.control_lote_caducidad ? 1 : 0, r.producto_id]);
      }

      const codUbic = (r.ubicacion || '').toString().trim();
      if (!codUbic) {
        omitidos++;
        errores.push({ sku: r.sku_interno, motivo: 'Ubicación requerida' });
        continue;
      }
      try {
        const ubId = await ubicacionId(codUbic);
        await svc.registrarEntrada(conn, {
          producto_id: r.producto_id, almacen_id, ubicacion_id: ubId,
          cantidad: r.cantidad, costo_unitario: r.costo_unitario || 0,
          proveedor_id: proveedor_id || null,
          numero_lote: r.numero_lote, fecha_caducidad: r.fecha_caducidad || null,
          motivo: 'Carga automática de factura', referencia,
          usuario_id: req.user?.id || null,
        });
        importados++;
      } catch (e) {
        omitidos++;
        if (errores.length < 30) errores.push({ sku: r.sku_interno, motivo: e.message });
      }
    }

    await conn.commit();
    res.json({ ok: true, importados, omitidos, errores, avisos });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { preview, confirmar };
