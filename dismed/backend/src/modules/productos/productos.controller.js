const { pool } = require('../../config/db');
const path = require('path');
const XLSX = require('xlsx');
const { parseCatalogo } = require('../inventario/import.catalogo');
const { buscarCandidatos, normalizar } = require('../solicitudes/matcher');
const { desempatarConIA } = require('../solicitudes/matcher.ia');
const fs = require('fs');
const { normalizarPrecioPublico, validarPrecios, tienePrecioLista } = require('./productos.pricing');
const { resolverId } = require('./taxonomia.util');

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
  'activo', 'vendible', 'publicar_web',
];

// Campos que se guardan como 0/1 (checkboxes), no como el valor crudo del body.
const CAMPOS_BOOLEANOS = new Set(['iva_exento', 'control_lote_caducidad', 'vendible', 'publicar_web']);

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

// Filtro compartido por list() y exportarExcel() (mismos criterios de
// búsqueda/estatus/familia/categoría; solo cambia paginación vs. exportación completa).
function construirFiltroProductos(query) {
  const search = query.q ? `%${query.q}%` : '%';
  const estatus = query.estatus || 'activos'; // activos | inactivos | todos
  const where = ['(p.sku_interno LIKE ? OR p.descripcion LIKE ? OR p.ean LIKE ?)'];
  const vals = [search, search, search];
  if (estatus !== 'todos') { where.push('p.activo = ?'); vals.push(estatus === 'inactivos' ? 0 : 1); }
  if (query.familia_id)    { where.push('p.familia_id = ?');    vals.push(query.familia_id); }
  if (query.categoria_id)  { where.push('p.categoria_id = ?');  vals.push(query.categoria_id); }
  return { where, vals };
}

async function list(req, res, next) {
  try {
    const { where, vals } = construirFiltroProductos(req.query);
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
              p.imagen_url, p.publicar_web,
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

// GET /productos/exportar → xlsx con el catálogo filtrado (mismos filtros que list, sin paginar).
async function exportarExcel(req, res, next) {
  try {
    const { where, vals } = construirFiltroProductos(req.query);

    const [rows] = await pool.query(
      `SELECT p.sku_interno, p.descripcion, p.fabricante,
              f.nombre AS familia_nombre, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre,
              p.unidad_medida, p.control_lote_caducidad, p.iva_exento,
              p.precio_costo, p.precio_lista, p.precio_publico, p.margen_ganancia,
              p.clave_sat, p.clave_unidad_sat, p.ean, p.activo, p.vendible
       FROM productos p
       LEFT JOIN familias f           ON f.id = p.familia_id
       LEFT JOIN categorias_prod c    ON c.id = p.categoria_id
       LEFT JOIN subcategorias_prod s ON s.id = p.subcategoria_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.sku_interno`,
      vals
    );

    const headers = [
      'SKU', 'Descripción', 'Fabricante', 'Familia', 'Categoría', 'Subcategoría',
      'U. Medida', 'Lote/Caducidad', 'IVA', 'Precio costo', 'Precio lista', 'Precio público',
      'Margen %', 'Clave SAT', 'Unidad SAT', 'EAN', 'Estado', 'Vendible',
    ];
    const aoa = [headers, ...rows.map((r) => [
      r.sku_interno, r.descripcion, r.fabricante || '',
      r.familia_nombre || '', r.categoria_nombre || '', r.subcategoria_nombre || '',
      r.unidad_medida || '', r.control_lote_caducidad ? 'Sí' : 'No', r.iva_exento ? 'Exento' : '16%',
      r.precio_costo != null ? Number(r.precio_costo) : '',
      r.precio_lista != null ? Number(r.precio_lista) : '',
      r.precio_publico != null ? Number(r.precio_publico) : '',
      r.margen_ganancia != null ? Number(r.margen_ganancia) : '',
      r.clave_sat || '', r.clave_unidad_sat || '', r.ean || '',
      r.activo ? 'Activo' : 'Inactivo', r.vendible ? 'Sí' : 'No',
    ])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogo');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="catalogo_productos.xlsx"');
    res.send(buf);
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

    // EAN: no puede repetirse entre productos activos (un producto dado de baja
    // puede conservar su código de barras histórico sin bloquear el reemplazo).
    if (req.body.ean !== undefined) {
      req.body.ean = (req.body.ean || '').toString().trim() || null;
    }
    if (req.body.ean) {
      const [[dupEan]] = await conn.query(
        'SELECT sku_interno, descripcion FROM productos WHERE ean = ? AND activo = 1', [req.body.ean]
      );
      if (dupEan) {
        await conn.rollback();
        return res.status(409).json({ error: `El código de barras ${req.body.ean} ya está asignado a ${dupEan.sku_interno} (${dupEan.descripcion})` });
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

    if (req.body.ean !== undefined) {
      req.body.ean = (req.body.ean || '').toString().trim() || null;
    }
    // Reactivar (PUT solo con activo:1) también puede resucitar un choque de EAN,
    // así que se revisa contra el EAN/activo resultante, no solo cuando ean viene en el body.
    if (req.body.ean !== undefined || req.body.activo !== undefined) {
      const [[actual]] = await pool.query('SELECT ean, activo FROM productos WHERE id = ?', [req.params.id]);
      if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });
      const eanFinal = req.body.ean !== undefined ? req.body.ean : actual.ean;
      const activoFinal = req.body.activo !== undefined ? (req.body.activo ? 1 : 0) : actual.activo;
      if (eanFinal && activoFinal) {
        const [[dupEan]] = await pool.query(
          'SELECT sku_interno, descripcion FROM productos WHERE ean = ? AND activo = 1 AND id != ?',
          [eanFinal, req.params.id]
        );
        if (dupEan) {
          return res.status(409).json({ error: `El código de barras ${eanFinal} ya está asignado a ${dupEan.sku_interno} (${dupEan.descripcion})` });
        }
      }
    }

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

// PATCH /productos/:id/venta — pantalla admin-only de precios y estatus vendible en masa.
// Solo toca precio_lista, precio_publico y vendible (nunca precio_costo ni el resto de PROD_FIELDS).
async function updateVenta(req, res, next) {
  try {
    const { precio_lista, precio_publico, vendible } = req.body;
    const [[actual]] = await pool.query(
      'SELECT precio_lista, precio_publico FROM productos WHERE id = ?', [req.params.id]
    );
    if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });

    const precioPublico = precio_publico !== undefined
      ? normalizarPrecioPublico(precio_publico)
      : actual.precio_publico;
    const precioLista = precio_lista !== undefined ? precio_lista : actual.precio_lista;

    const errorPrecios = validarPrecios(precioLista, precioPublico);
    if (errorPrecios) return res.status(400).json({ error: errorPrecios });

    const sets = []; const vals = [];
    if (precio_lista !== undefined)   { sets.push('precio_lista = ?');   vals.push(precio_lista); }
    if (precio_publico !== undefined) { sets.push('precio_publico = ?'); vals.push(precioPublico); }
    if (vendible !== undefined)       { sets.push('vendible = ?');      vals.push(vendible ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });

    vals.push(req.params.id);
    await pool.query(`UPDATE productos SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Campos obligatorios para dar de ALTA un producto nuevo (no aplica a actualizaciones
// en modo parcial: ahí solo se exigen los campos cuya columna vino en el archivo).
const CAMPOS_OBLIGATORIOS_ALTA = [
  { campo: 'descripcion',   label: 'Descripción',  columna: 'DESCRIPCION' },
  { campo: 'familia',       label: 'Familia',       columna: 'FAMILIA' },
  { campo: 'categoria',     label: 'Categoría',     columna: 'CATEGORIA' },
  { campo: 'subcategoria',  label: 'Subcategoría',  columna: 'SUBCATEGORIA' },
  { campo: 'precio_lista',  label: 'Precio lista',  columna: 'PRECIO_LISTA' },
  { campo: 'unidad_medida', label: 'Unidad',        columna: 'UNIDAD_VENTA' },
];

// Determina _errores/_ok/_duplicado de cada fila según el modo de importación:
// - Modo completo (default): todo producto (nuevo o existente) debe traer los campos obligatorios.
// - Modo parcial: los productos YA EN BD solo exigen que las columnas presentes en el
//   archivo traigan valor; los productos NUEVOS siguen requiriendo el set completo
//   (no se puede insertar un producto a medias).
function validarFilasImportacion(productos, columnasPresentes, modoParcial) {
  productos.forEach((p) => {
    const errores = [];
    if (!p.sku_interno) errores.push('SKU (Id) vacío');
    if (p._ean_error) errores.push(p._ean_error);

    if (modoParcial && p._ya_en_bd) {
      for (const { campo, label } of CAMPOS_OBLIGATORIOS_ALTA) {
        if (columnasPresentes[campo] && (p[campo] == null || p[campo] === '')) {
          errores.push(`${label} vacío (la columna viene en el archivo pero sin valor en esta fila)`);
        }
      }
    } else {
      for (const { campo, label, columna } of CAMPOS_OBLIGATORIOS_ALTA) {
        if (p[campo] == null || p[campo] === '') {
          errores.push(modoParcial
            ? `${label} vacío — producto nuevo: falta la columna ${columna} en el archivo`
            : `${label} vacío`);
        }
      }
    }

    p._errores = errores;
    p._ok = errores.length === 0 && !p._duplicado;
  });

  return {
    ok: productos.filter((p) => p._ok).length,
    con_errores: productos.filter((p) => p._errores.length > 0).length,
  };
}

// ── Importación del catálogo (preview) ────────────────────────────────────────
async function importPreview(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const modoParcial = req.body.modo_parcial === 'true' || req.body.modo_parcial === '1';
    const result = parseCatalogo(req.file.path);
    // Marcar también duplicados contra la BD (SKU ya existente)
    const skus = result.productos.map((p) => p.sku_interno).filter(Boolean);
    let yaEnBd = 0;
    if (skus.length) {
      const [existentes] = await pool.query(
        'SELECT sku_interno FROM productos WHERE sku_interno IN (?)', [skus]
      );
      const set = new Set(existentes.map((e) => e.sku_interno));
      result.productos.forEach((p) => { p._ya_en_bd = set.has(p.sku_interno); });
      yaEnBd = existentes.length;
    }

    // Marcar duplicados de EAN: contra la BD (otro SKU ya activo) y dentro del propio archivo.
    const eans = result.productos.map((p) => (p.ean || '').toString().trim()).filter(Boolean);
    if (eans.length) {
      const [existentesEan] = await pool.query(
        'SELECT sku_interno, ean FROM productos WHERE ean IN (?) AND activo = 1', [eans]
      );
      const skuPorEanBd = new Map(existentesEan.map((e) => [e.ean, e.sku_interno]));
      const conteoArchivo = new Map();
      eans.forEach((e) => conteoArchivo.set(e, (conteoArchivo.get(e) || 0) + 1));
      result.productos.forEach((p) => {
        const ean = (p.ean || '').toString().trim();
        if (!ean) return;
        const skuBd = skuPorEanBd.get(ean);
        if (skuBd && skuBd !== p.sku_interno) {
          p._ean_error = `EAN ${ean} ya está asignado a ${skuBd}`;
        } else if (conteoArchivo.get(ean) > 1) {
          p._ean_error = `EAN ${ean} repetido en el archivo`;
        }
      });
    }

    const { ok, con_errores } = validarFilasImportacion(result.productos, result.columnasPresentes, modoParcial);
    result.resumen.ok = ok;
    result.resumen.con_errores = con_errores;
    result.resumen.ya_en_bd = yaEnBd;
    result.modo_parcial = modoParcial;
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    res.json(result);
  } catch (err) { next(err); }
}

// Inserta o reemplaza por completo un producto (modo de importación "completo",
// usado también para dar de ALTA productos nuevos aunque el modo sea "parcial":
// un producto nuevo no puede quedar a medias).
async function insertarOReemplazarCompleto(conn, cache, p, sku) {
  const ean = (p.ean || '').toString().trim() || null;
  if (ean) {
    const [[dupEan]] = await conn.query(
      'SELECT sku_interno FROM productos WHERE ean = ? AND activo = 1 AND sku_interno != ?', [ean, sku]
    );
    if (dupEan) return { error: `EAN ${ean} ya está asignado a ${dupEan.sku_interno}` };
  }
  p.ean = ean;

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
        sustancia_activa, tamano, calibre, especificacion, publicar_web)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
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
     p.fabricante || null, ean,
     p.sustancia_activa || null, p.tamano || null, p.calibre || null, p.especificacion || null]
  );
  return { error: null, resultado: r.affectedRows === 1 ? 'insertado' : 'actualizado' }; // affectedRows: 1 = insert, 2 = update (ON DUPLICATE KEY)
}

// Actualiza SOLO los campos cuya columna vino en el archivo (modo parcial),
// dejando el resto del producto intacto. `actual` es la fila vigente en BD
// (necesaria para resolver jerarquías familia→categoría→subcategoría cuando
// solo una parte de la jerarquía viene en el archivo, y para validar la regla
// de precios contra el valor efectivo final).
async function actualizarParcial(conn, cache, p, sku, cp, actual) {
  const sets = []; const vals = [];
  const trae = (campo) => cp[campo] && p[campo] != null && p[campo] !== '';

  if (trae('descripcion')) {
    sets.push('descripcion = ?', 'descripcion_norm = ?');
    vals.push(p.descripcion, normalizar(p.descripcion).substring(0, 800));
  }

  let familiaId = actual.familia_id;
  if (trae('familia')) {
    familiaId = await resolverId(conn, cache, 'familias', ['nombre'], [p.familia], ['nombre'], [p.familia]);
    sets.push('familia_id = ?'); vals.push(familiaId);
  }
  let categoriaId = actual.categoria_id;
  if (trae('categoria')) {
    categoriaId = await resolverId(conn, cache, 'categorias_prod',
      ['familia_id', 'nombre'], [familiaId, p.categoria], ['familia_id', 'nombre'], [familiaId, p.categoria]);
    sets.push('categoria_id = ?'); vals.push(categoriaId);
  }
  if (trae('subcategoria')) {
    const subcatId = await resolverId(conn, cache, 'subcategorias_prod',
      ['categoria_id', 'nombre'], [categoriaId, p.subcategoria], ['categoria_id', 'nombre'], [categoriaId, p.subcategoria]);
    sets.push('subcategoria_id = ?'); vals.push(subcatId);
  }
  if (trae('unidad_medida')) {
    const unidadId = await resolverId(conn, cache, 'unidades_medida',
      ['nombre'], [p.unidad_medida], ['nombre', 'factor_sugerido'], [p.unidad_medida, p.factor_empaque ?? null]);
    sets.push('unidad_medida = ?', 'unidad_medida_id = ?'); vals.push(p.unidad_medida, unidadId);
    if (p.factor_empaque != null) { sets.push('factor_empaque = ?'); vals.push(p.factor_empaque); }
  }

  // Regla legal (precio_lista <= precio_publico) contra el valor EFECTIVO final:
  // el nuevo si vino en el archivo, o el que ya tenía el producto si no vino.
  const precioListaFinal = trae('precio_lista') ? p.precio_lista : actual.precio_lista;
  const precioPublicoFinal = trae('precio_publico') ? normalizarPrecioPublico(p.precio_publico) : actual.precio_publico;
  const errorPrecios = validarPrecios(precioListaFinal, precioPublicoFinal);
  if (errorPrecios) return { error: errorPrecios };

  if (trae('precio_lista'))   { sets.push('precio_lista = ?');   vals.push(p.precio_lista); }
  if (trae('precio_publico')) { sets.push('precio_publico = ?'); vals.push(precioPublicoFinal); }
  if (trae('precio_costo'))   { sets.push('precio_costo = ?');   vals.push(p.precio_costo); }
  if (cp.iva_exento && p._ivaCeldaProvista) { sets.push('iva_exento = ?'); vals.push(p.iva_exento ? 1 : 0); }
  if (trae('ieps'))              { sets.push('ieps = ?');              vals.push(p.ieps); }
  if (trae('clave_sat'))         { sets.push('clave_sat = ?');         vals.push(p.clave_sat); }
  if (trae('clave_unidad_sat'))  { sets.push('clave_unidad_sat = ?');  vals.push(p.clave_unidad_sat); }
  if (trae('sustancia_activa'))  { sets.push('sustancia_activa = ?');  vals.push(p.sustancia_activa); }
  if (trae('tamano'))            { sets.push('tamano = ?');            vals.push(p.tamano); }
  if (trae('calibre'))           { sets.push('calibre = ?');           vals.push(p.calibre); }
  if (trae('especificacion'))    { sets.push('especificacion = ?');    vals.push(p.especificacion); }
  if (trae('fabricante'))        { sets.push('fabricante = ?');        vals.push(p.fabricante); }
  if (trae('ean')) {
    const ean = p.ean.toString().trim() || null;
    if (ean) {
      const [[dupEan]] = await conn.query(
        'SELECT sku_interno FROM productos WHERE ean = ? AND activo = 1 AND sku_interno != ?', [ean, sku]
      );
      if (dupEan) return { error: `EAN ${ean} ya está asignado a ${dupEan.sku_interno}` };
    }
    sets.push('ean = ?'); vals.push(ean);
  }

  if (!sets.length) return { error: null, sinCambios: true };

  vals.push(sku);
  await conn.query(`UPDATE productos SET ${sets.join(', ')} WHERE sku_interno = ?`, vals);
  return { error: null };
}

// ── Importación del catálogo (confirmar e insertar) ───────────────────────────
async function importConfirm(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { productos, modo_parcial, columnas_presentes } = req.body;
    if (!Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ error: 'productos[] requerido' });
    }
    const modoParcial = !!modo_parcial;
    const cp = columnas_presentes || {};
    await conn.beginTransaction();

    // En modo parcial necesitamos la fila vigente de los productos que ya existen,
    // tanto para saber si el SKU es alta o actualización como para resolver
    // jerarquías y validar precios contra el valor efectivo final.
    let actualesPorSku = new Map();
    if (modoParcial) {
      const skus = productos.map((p) => (p.sku_interno || '').toString().trim()).filter(Boolean);
      if (skus.length) {
        const [rows] = await conn.query(
          `SELECT sku_interno, familia_id, categoria_id, subcategoria_id, precio_lista, precio_publico
           FROM productos WHERE sku_interno IN (?)`, [skus]
        );
        actualesPorSku = new Map(rows.map((r) => [r.sku_interno, r]));
      }
    }

    const cache = {};
    let insertados = 0, actualizados = 0, omitidos = 0;
    const errores = [];

    for (const p of productos) {
      const sku = (p.sku_interno || '').toString().trim();
      if (!sku) { omitidos++; errores.length < 20 && errores.push({ sku, motivo: 'SKU vacío' }); continue; }

      const actual = modoParcial ? actualesPorSku.get(sku) : null;

      if (!modoParcial || !actual) {
        // Alta (siempre) o modo completo (siempre): exige el set obligatorio completo.
        if (!p.descripcion || !p.familia || !p.categoria || !p.subcategoria
            || p.precio_lista == null || !p.unidad_medida) {
          omitidos++;
          if (errores.length < 20) errores.push({ sku, motivo: 'Faltan campos obligatorios' });
          continue;
        }
        p.precio_publico = normalizarPrecioPublico(p.precio_publico);
        const errorPrecios = validarPrecios(p.precio_lista, p.precio_publico);
        if (errorPrecios) {
          omitidos++;
          if (errores.length < 20) errores.push({ sku, motivo: errorPrecios });
          continue;
        }
        const { error: errorEan, resultado } = await insertarOReemplazarCompleto(conn, cache, p, sku);
        if (errorEan) {
          omitidos++;
          if (errores.length < 20) errores.push({ sku, motivo: errorEan });
          continue;
        }
        if (resultado === 'insertado') insertados++; else actualizados++;
        continue;
      }

      // Modo parcial + producto ya existente: solo se tocan los campos cuya columna vino en el archivo.
      const { error, sinCambios } = await actualizarParcial(conn, cache, p, sku, cp, actual);
      if (error) {
        omitidos++;
        if (errores.length < 20) errores.push({ sku, motivo: error });
        continue;
      }
      if (sinCambios) { omitidos++; continue; }
      actualizados++;
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

// ── Presentaciones de venta (mismo producto, misma existencia en piezas,
// precio y código de barras propios por presentación — ver migrate_v39) ──

async function listPresentaciones(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, producto_id, nombre, factor_conversion, precio_lista, ean, activo_pos, orden
       FROM producto_presentaciones WHERE producto_id = ? ORDER BY orden, id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createPresentacion(req, res, next) {
  try {
    const { nombre, factor_conversion, precio_lista, ean, activo_pos, orden } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const factor = Number(factor_conversion);
    if (!(factor > 0)) return res.status(400).json({ error: 'factor_conversion debe ser > 0' });
    const [[prod]] = await pool.query('SELECT id FROM productos WHERE id = ?', [req.params.id]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
    const [r] = await pool.query(
      `INSERT INTO producto_presentaciones
         (producto_id, nombre, factor_conversion, precio_lista, ean, activo_pos, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, nombre.trim(), factor, precio_lista ?? null, ean?.trim() || null,
       activo_pos === undefined ? 1 : (activo_pos ? 1 : 0), orden || 0]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código de barras ya está asignado a otra presentación' });
    next(err);
  }
}

async function updatePresentacion(req, res, next) {
  try {
    const sets = []; const vals = [];
    if (req.body.nombre !== undefined) {
      if (!req.body.nombre?.trim()) return res.status(400).json({ error: 'nombre no puede quedar vacío' });
      sets.push('nombre = ?'); vals.push(req.body.nombre.trim());
    }
    if (req.body.factor_conversion !== undefined) {
      const factor = Number(req.body.factor_conversion);
      if (!(factor > 0)) return res.status(400).json({ error: 'factor_conversion debe ser > 0' });
      sets.push('factor_conversion = ?'); vals.push(factor);
    }
    if (req.body.precio_lista !== undefined) { sets.push('precio_lista = ?'); vals.push(req.body.precio_lista); }
    if (req.body.ean !== undefined) { sets.push('ean = ?'); vals.push(req.body.ean?.trim() || null); }
    if (req.body.activo_pos !== undefined) { sets.push('activo_pos = ?'); vals.push(req.body.activo_pos ? 1 : 0); }
    if (req.body.orden !== undefined) { sets.push('orden = ?'); vals.push(req.body.orden); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.presentacionId);
    const [r] = await pool.query(`UPDATE producto_presentaciones SET ${sets.join(', ')} WHERE id = ?`, vals);
    if (!r.affectedRows) return res.status(404).json({ error: 'Presentación no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código de barras ya está asignado a otra presentación' });
    next(err);
  }
}

async function removePresentacion(req, res, next) {
  try {
    const [r] = await pool.query('DELETE FROM producto_presentaciones WHERE id = ?', [req.params.presentacionId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Presentación no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({ error: 'Esta presentación ya se usó en ventas; desactívala (activo_pos) en vez de borrarla' });
    }
    next(err);
  }
}

/**
 * POST /api/productos/:id/imagen — multipart 'archivo'. Foto para el catálogo
 * público (tienda). El nombre del archivo lo genera multer (nunca el
 * original); mismo patrón que empresas.controller.js#subirLogo.
 */
async function subirImagen(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'archivo requerido (png, jpg o webp)' });
    const [[producto]] = await pool.query('SELECT id, imagen_url FROM productos WHERE id = ?', [req.params.id]);
    if (!producto) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    const rel = req.file.filename;
    await pool.query('UPDATE productos SET imagen_url = ? WHERE id = ?', [rel, producto.id]);

    // Limpieza best-effort de la imagen anterior
    if (producto.imagen_url && producto.imagen_url !== rel) {
      fs.unlink(path.join(req.file.destination, producto.imagen_url), () => {});
    }
    res.status(201).json({ url: `/uploads/productos/${rel}` });
  } catch (err) { next(err); }
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

module.exports = {
  list, match, matchIa, getById, create, update, updateVenta, subirImagen, importPreview, importConfirm, plantillaCatalogo, remove, removeMultiple,
  listPresentaciones, createPresentacion, updatePresentacion, removePresentacion, exportarExcel,
};
