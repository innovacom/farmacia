const { pool } = require('../../config/db');
const XLSX = require('xlsx');
const { parseCatalogo } = require('../inventario/import.catalogo');
const { buscarCandidatos, normalizar } = require('../solicitudes/matcher');
const { desempatarConIA } = require('../solicitudes/matcher.ia');
const fs = require('fs');
const { normalizarPrecioPublico, validarPrecios, tienePrecioLista } = require('./productos.pricing');

// Campos editables de producto (alta/edición)
const PROD_FIELDS = [
  'descripcion', 'descripcion_corta', 'categoria',
  'unidad_medida', 'unidad_medida_id', 'clave_sat', 'clave_unidad_sat', 'stock_minimo',
  'familia_id', 'categoria_id', 'subcategoria_id',
  'unidad_base', 'factor_empaque', 'control_lote_caducidad',
  'precio_lista', 'precio_publico', 'precio_costo', 'iva_exento', 'ieps',
  'fabricante', 'ean', 'sustancia_activa', 'tamano', 'calibre', 'especificacion',
  'clave_cuadro_basico', 'clasificacion_cofepris',
  'cuenta_ingreso_codigo', 'cuenta_costo_codigo',
  'activo', 'vendible',
];

// Campos que se guardan como 0/1 (checkboxes), no como el valor crudo del body.
const CAMPOS_BOOLEANOS = new Set(['iva_exento', 'control_lote_caducidad', 'vendible']);

// Alta: si no mandan `vendible` explícito, se deduce de si viene precio_lista.
function autoVendibleCreate(body) {
  if (body.vendible !== undefined) return;
  body.vendible = tienePrecioLista(body.precio_lista) ? 1 : 0;
}

// Edición: solo se recalcula si esta petición está tocando precio_lista
// (si no la toca, no se pisa un `vendible` que el admin ya haya fijado a mano).
function autoVendibleUpdate(body) {
  if (body.precio_lista === undefined || body.vendible !== undefined) return;
  body.vendible = tienePrecioLista(body.precio_lista) ? 1 : 0;
}

async function list(req, res, next) {
  try {
    const search = req.query.q ? `%${req.query.q}%` : '%';
    const estatus = req.query.estatus || 'activos'; // activos | inactivos | todos
    const where = ['(p.sku_interno LIKE ? OR p.descripcion LIKE ?)'];
    const vals = [search, search];
    if (estatus !== 'todos') where.push(`p.activo = ${estatus === 'inactivos' ? 0 : 1}`);
    if (req.query.familia_id)    { where.push('p.familia_id = ?');    vals.push(req.query.familia_id); }
    if (req.query.categoria_id)  { where.push('p.categoria_id = ?');  vals.push(req.query.categoria_id); }
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    // Con ?offset= responde { rows, total } (paginación real). Sin él conserva
    // la respuesta plana (array) para los consumidores existentes.
    const conOffset = req.query.offset !== undefined;
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const [rows] = await pool.query(
      `SELECT p.id, p.sku_interno, p.descripcion, p.descripcion_corta,
              p.unidad_medida, p.stock_minimo, p.activo,
              p.control_lote_caducidad, p.unidad_base, p.factor_empaque,
              p.precio_lista, p.precio_publico, p.precio_costo, p.margen_ganancia, p.iva_exento, p.vendible,
              p.familia_id, p.categoria_id, p.subcategoria_id, p.fabricante,
              p.clave_sat, p.clave_unidad_sat, p.ean, p.clasificacion_cofepris,
              p.cuenta_ingreso_codigo, p.cuenta_costo_codigo,
              f.nombre AS familia_nombre, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre
       FROM productos p
       LEFT JOIN familias f           ON f.id = p.familia_id
       LEFT JOIN categorias_prod c    ON c.id = p.categoria_id
       LEFT JOIN subcategorias_prod s ON s.id = p.subcategoria_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.sku_interno
       LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );
    if (!conOffset) return res.json(rows);

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM productos p WHERE ${where.join(' AND ')}`,
      vals
    );
    res.json({ rows, total });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[row]] = await pool.query('SELECT * FROM productos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(row);
  } catch (err) { next(err); }
}

// Sugiere productos del catálogo para una descripción/código de la solicitud.
// GET /productos/match?q=&descripcion=&cliente_id=&codigo_cliente=&codigo_gobierno=
async function match(req, res, next) {
  try {
    const { q, descripcion, cliente_id, codigo_cliente, codigo_gobierno } = req.query;
    const candidatos = await buscarCandidatos({
      q,
      descripcion,
      cliente_id: cliente_id || null,
      codigo_cliente: codigo_cliente || null,
      codigo_gobierno: codigo_gobierno || null,
    });
    res.json({ candidatos });
  } catch (err) { next(err); }
}

// IA de desempate: elige entre el shortlist del matcher (lista cerrada).
// POST /productos/match-ia  Body: { descripcion, codigo_cliente?, codigo_gobierno?, cliente_id? }
async function matchIa(req, res, next) {
  try {
    const { descripcion, codigo_cliente, codigo_gobierno, cliente_id } = req.body;
    if (!descripcion || !String(descripcion).trim()) {
      return res.status(400).json({ error: 'descripcion requerida' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'IA no configurada (GEMINI_API_KEY)' });
    }
    const candidatos = await buscarCandidatos({
      descripcion,
      cliente_id: cliente_id || null,
      codigo_cliente: codigo_cliente || null,
      codigo_gobierno: codigo_gobierno || null,
    });
    if (!candidatos.length) {
      return res.json({ candidatos: [], eleccion: null });
    }
    const shortlist = candidatos.slice(0, 5);
    const eleccion = await desempatarConIA({
      descripcion, codigo_cliente, codigo_gobierno, candidatos: shortlist,
    });
    res.json({ candidatos: shortlist, eleccion });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { descripcion } = req.body;
    if (!descripcion) {
      await conn.rollback();
      return res.status(400).json({ error: 'descripcion requerida' });
    }

    if (req.body.precio_publico !== undefined) {
      req.body.precio_publico = normalizarPrecioPublico(req.body.precio_publico);
    }
    const errorPrecios = validarPrecios(req.body.precio_lista, req.body.precio_publico);
    if (errorPrecios) {
      await conn.rollback();
      return res.status(400).json({ error: errorPrecios });
    }
    autoVendibleCreate(req.body);

    // SKU: usar el código INNOVACOM si viene; si no, autogenerar DM-#####
    let sku = (req.body.sku_interno || '').toString().trim();
    if (!sku) {
      await conn.query('CALL sp_generar_sku(@sku)');
      const [[{ sku: gen }]] = await conn.query('SELECT @sku AS sku');
      sku = gen;
    } else {
      const [[dup]] = await conn.query('SELECT id FROM productos WHERE sku_interno = ?', [sku]);
      if (dup) {
        await conn.rollback();
        return res.status(409).json({ error: `El SKU ${sku} ya existe` });
      }
    }

    const cols = ['sku_interno']; const ph = ['?']; const vals = [sku];
    PROD_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) {
        cols.push(f); ph.push('?');
        vals.push(CAMPOS_BOOLEANOS.has(f) ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });
    // descripcion_norm para la búsqueda FULLTEXT
    cols.push('descripcion_norm'); ph.push('?');
    vals.push(normalizar(descripcion).substring(0, 800));

    const [r] = await conn.query(
      `INSERT INTO productos (${cols.join(', ')}) VALUES (${ph.join(', ')})`, vals
    );
    await conn.commit();
    res.status(201).json({ id: r.insertId, sku_interno: sku, descripcion });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  try {
    if (req.body.precio_publico !== undefined) {
      req.body.precio_publico = normalizarPrecioPublico(req.body.precio_publico);
    }
    if (req.body.precio_lista !== undefined || req.body.precio_publico !== undefined) {
      const [[actual]] = await pool.query(
        'SELECT precio_lista, precio_publico FROM productos WHERE id = ?', [req.params.id]
      );
      if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });
      const precioLista   = req.body.precio_lista   !== undefined ? req.body.precio_lista   : actual.precio_lista;
      const precioPublico = req.body.precio_publico !== undefined ? req.body.precio_publico : actual.precio_publico;
      const errorPrecios = validarPrecios(precioLista, precioPublico);
      if (errorPrecios) return res.status(400).json({ error: errorPrecios });
    }
    autoVendibleUpdate(req.body);

    const sets = []; const vals = [];
    PROD_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(CAMPOS_BOOLEANOS.has(f) ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    });
    // Recalcular descripcion_norm si cambió la descripción
    if (req.body.descripcion !== undefined) {
      sets.push('descripcion_norm = ?');
      vals.push(normalizar(req.body.descripcion).substring(0, 800));
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.id);
    await pool.query(`UPDATE productos SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Importación del catálogo (preview) ────────────────────────────────────────
async function importPreview(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const result = parseCatalogo(req.file.path);
    // Marcar también duplicados contra la BD (SKU ya existente)
    const skus = result.productos.map((p) => p.sku_interno).filter(Boolean);
    if (skus.length) {
      const [existentes] = await pool.query(
        'SELECT sku_interno FROM productos WHERE sku_interno IN (?)', [skus]
      );
      const set = new Set(existentes.map((e) => e.sku_interno));
      result.productos.forEach((p) => { p._ya_en_bd = set.has(p.sku_interno); });
      result.resumen.ya_en_bd = existentes.length;
    }
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    res.json(result);
  } catch (err) { next(err); }
}

// Resuelve (o crea) un id de taxonomía/unidad usando un cache en memoria
async function resolverId(conn, cache, tabla, whereCols, whereVals, insertCols, insertVals) {
  const key = tabla + '|' + whereVals.join('|');
  if (cache[key]) return cache[key];
  const wsql = whereCols.map((c) => `${c} = ?`).join(' AND ');
  const [[row]] = await conn.query(`SELECT id FROM ${tabla} WHERE ${wsql} LIMIT 1`, whereVals);
  if (row) { cache[key] = row.id; return row.id; }
  const [r] = await conn.query(
    `INSERT INTO ${tabla} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    insertVals
  );
  cache[key] = r.insertId;
  return r.insertId;
}

// ── Importación del catálogo (confirmar e insertar) ───────────────────────────
async function importConfirm(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { productos } = req.body;
    if (!Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ error: 'productos[] requerido' });
    }
    await conn.beginTransaction();

    const cache = {};
    let insertados = 0, actualizados = 0, omitidos = 0;
    const errores = [];

    for (const p of productos) {
      const sku = (p.sku_interno || '').toString().trim();
      // Validación mínima de obligatorias
      if (!sku || !p.descripcion || !p.familia || !p.categoria || !p.subcategoria
          || p.precio_lista == null || !p.unidad_medida) {
        omitidos++;
        if (errores.length < 20) errores.push({ sku, motivo: 'Faltan campos obligatorios' });
        continue;
      }

      // Regla legal: precio_lista nunca mayor a precio_publico (0/vacío = sin tope)
      p.precio_publico = normalizarPrecioPublico(p.precio_publico);
      const errorPrecios = validarPrecios(p.precio_lista, p.precio_publico);
      if (errorPrecios) {
        omitidos++;
        if (errores.length < 20) errores.push({ sku, motivo: errorPrecios });
        continue;
      }

      // Resolver taxonomía (crea lo que falte, aunque la precarga debería cubrir todo)
      const familiaId = await resolverId(conn, cache, 'familias',
        ['nombre'], [p.familia], ['nombre'], [p.familia]);
      const categoriaId = await resolverId(conn, cache, 'categorias_prod',
        ['familia_id', 'nombre'], [familiaId, p.categoria], ['familia_id', 'nombre'], [familiaId, p.categoria]);
      const subcatId = await resolverId(conn, cache, 'subcategorias_prod',
        ['categoria_id', 'nombre'], [categoriaId, p.subcategoria], ['categoria_id', 'nombre'], [categoriaId, p.subcategoria]);
      const unidadId = await resolverId(conn, cache, 'unidades_medida',
        ['nombre'], [p.unidad_medida], ['nombre', 'factor_sugerido'], [p.unidad_medida, p.factor_empaque ?? null]);

      const [r] = await conn.query(
        `INSERT INTO productos
           (sku_interno, descripcion, descripcion_norm, familia_id, categoria_id, subcategoria_id,
            unidad_medida, unidad_medida_id, unidad_base, factor_empaque,
            control_lote_caducidad, precio_lista, precio_publico, precio_costo, iva_exento, ieps,
            clave_sat, clave_unidad_sat, clave_cuadro_basico, fabricante, ean,
            sustancia_activa, tamano, calibre, especificacion)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           descripcion = VALUES(descripcion), descripcion_norm = VALUES(descripcion_norm),
           familia_id = VALUES(familia_id),
           categoria_id = VALUES(categoria_id), subcategoria_id = VALUES(subcategoria_id),
           unidad_medida = VALUES(unidad_medida), unidad_medida_id = VALUES(unidad_medida_id),
           factor_empaque = VALUES(factor_empaque),
           control_lote_caducidad = VALUES(control_lote_caducidad),
           precio_lista = VALUES(precio_lista), precio_publico = VALUES(precio_publico),
           precio_costo = VALUES(precio_costo),
           iva_exento = VALUES(iva_exento), ieps = VALUES(ieps),
           clave_sat = VALUES(clave_sat), clave_unidad_sat = VALUES(clave_unidad_sat),
           clave_cuadro_basico = VALUES(clave_cuadro_basico),
           fabricante = VALUES(fabricante), ean = VALUES(ean),
           sustancia_activa = VALUES(sustancia_activa), tamano = VALUES(tamano),
           calibre = VALUES(calibre), especificacion = VALUES(especificacion)`,
        [sku, p.descripcion, normalizar(p.descripcion).substring(0, 800),
         familiaId, categoriaId, subcatId,
         p.unidad_medida, unidadId, p.unidad_base || 'pieza', p.factor_empaque ?? 1,
         p.control_lote_caducidad ? 1 : 0,
         p.precio_lista, p.precio_publico ?? null, p.precio_costo ?? null, p.iva_exento ? 1 : 0, p.ieps ?? null,
         p.clave_sat || null, p.clave_unidad_sat || null, p.clave_cuadro_basico || null,
         p.fabricante || null, p.ean || null,
         p.sustancia_activa || null, p.tamano || null, p.calibre || null, p.especificacion || null]
      );
      // affectedRows: 1 = insert, 2 = update (ON DUPLICATE KEY)
      if (r.affectedRows === 1) insertados++; else actualizados++;
    }

    await conn.commit();
    res.json({ ok: true, insertados, actualizados, omitidos, errores });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

async function remove(req, res, next) {
  try {
    await pool.query('UPDATE productos SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removeMultiple(req, res, next) {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requerido' });
    await pool.query('UPDATE productos SET activo = 0 WHERE id IN (?)', [ids]);
    res.json({ ok: true, count: ids.length });
  } catch (err) { next(err); }
}

/** GET /productos/import-catalogo/plantilla → xlsx de ejemplo con el layout que espera el import (hoja CATALOGO). */
function plantillaCatalogo(req, res, next) {
  try {
    const headers = [
      'EAN', 'Id', 'DESCRIPCION', 'FAMILIA', 'CATEGORIA', 'SUBCATEGORIA', 'UNIDAD_VENTA',
      'PRECIO_PUBLICO', 'PRECIO_LISTA', 'PRECIO_COSTO', 'IVA', 'IEPS', 'codigo_sat', 'unidad_sat',
      'SUSTANCIA ACTIVA', 'TAMAÑO', 'LARGO', 'ANCHO', 'CALIBRE', 'ESPECIFICACION', 'LABORATORIO',
    ];
    const ejemplos = [
      ['7501001234567', 'INAP00238', 'CANULA NASAL ADULTO', 'MATERIAL DE CURACION', 'OXIGENOTERAPIA',
        'CANULAS', 'PIEZA', 25.00, 12.50, 8.00, 0.16, 0, '42271707', 'H87', '', '2 M', '', '', '', 'PUNTA SUAVE', 'AMBU'],
      [0, 'DM-00042', 'GASA ESTERIL 10X10', 'MATERIAL DE CURACION', 'GASAS',
        'ESTERILES', 'CAJA C/100', 120.00, 85.00, 55.00, 0, 0, '42311505', 'XBX', '', '10X10 CM', '', '', '', '', 'DEGASA'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ejemplos]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CATALOGO');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_catalogo_maestro.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
}

module.exports = { list, match, matchIa, getById, create, update, importPreview, importConfirm, plantillaCatalogo, remove, removeMultiple };
