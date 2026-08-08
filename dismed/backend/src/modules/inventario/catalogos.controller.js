const { pool } = require('../../config/db');
const fs = require('fs');
const XLSX = require('xlsx');
const { parseCatalogosApoyo } = require('./import.catalogos');

// ── Familias ────────────────────────────────────────────────────────────────
function condActivo(req) {
  const estatus = req.query.estatus || 'activos'; // activos | inactivos | todos
  if (estatus === 'todos') return '';
  return `activo = ${estatus === 'inactivos' ? 0 : 1}`;
}

async function listFamilias(req, res, next) {
  try {
    const cond = condActivo(req);
    const [rows] = await pool.query(
      `SELECT id, nombre, activo FROM familias ${cond ? `WHERE ${cond}` : ''} ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function removeFamilia(req, res, next) {
  try {
    await pool.query('UPDATE familias SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function createFamilia(req, res, next) {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const [r] = await pool.query(
      'INSERT INTO familias (nombre) VALUES (?) ON DUPLICATE KEY UPDATE activo = 1',
      [nombre.trim()]
    );
    res.status(201).json({ id: r.insertId, nombre: nombre.trim() });
  } catch (err) { next(err); }
}

async function updateFamilia(req, res, next) {
  try {
    const { nombre, activo } = req.body;
    const sets = []; const vals = [];
    if (nombre !== undefined) { sets.push('nombre = ?'); vals.push(nombre.trim()); }
    if (activo !== undefined) { sets.push('activo = ?'); vals.push(activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE familias SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Categorías (por familia) ─────────────────────────────────────────────────
async function listCategorias(req, res, next) {
  try {
    const { familia_id } = req.query;
    const cond = condActivo(req);
    const where = cond ? [`c.${cond}`] : [];
    const vals = [];
    if (familia_id) { where.push('c.familia_id = ?'); vals.push(familia_id); }
    const [rows] = await pool.query(
      `SELECT c.id, c.familia_id, c.nombre, c.activo, f.nombre AS familia_nombre
       FROM categorias_prod c JOIN familias f ON f.id = c.familia_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.nombre`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function removeCategoria(req, res, next) {
  try {
    await pool.query('UPDATE categorias_prod SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function createCategoria(req, res, next) {
  try {
    const { familia_id, nombre } = req.body;
    if (!familia_id || !nombre?.trim()) return res.status(400).json({ error: 'familia_id y nombre requeridos' });
    const [r] = await pool.query(
      'INSERT INTO categorias_prod (familia_id, nombre) VALUES (?, ?) ON DUPLICATE KEY UPDATE activo = 1',
      [familia_id, nombre.trim()]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateCategoria(req, res, next) {
  try {
    const { nombre, activo, familia_id } = req.body;
    const sets = []; const vals = [];
    if (nombre !== undefined)     { sets.push('nombre = ?');     vals.push(nombre.trim()); }
    if (familia_id !== undefined) { sets.push('familia_id = ?'); vals.push(familia_id); }
    if (activo !== undefined)     { sets.push('activo = ?');     vals.push(activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE categorias_prod SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Subcategorías (por categoría) ────────────────────────────────────────────
async function listSubcategorias(req, res, next) {
  try {
    const { categoria_id } = req.query;
    const cond = condActivo(req);
    const where = cond ? [`s.${cond}`] : [];
    const vals = [];
    if (categoria_id) { where.push('s.categoria_id = ?'); vals.push(categoria_id); }
    const [rows] = await pool.query(
      `SELECT s.id, s.categoria_id, s.nombre, s.activo
       FROM subcategorias_prod s
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.nombre`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function removeSubcategoria(req, res, next) {
  try {
    await pool.query('UPDATE subcategorias_prod SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function createSubcategoria(req, res, next) {
  try {
    const { categoria_id, nombre } = req.body;
    if (!categoria_id || !nombre?.trim()) return res.status(400).json({ error: 'categoria_id y nombre requeridos' });
    const [r] = await pool.query(
      'INSERT INTO subcategorias_prod (categoria_id, nombre) VALUES (?, ?) ON DUPLICATE KEY UPDATE activo = 1',
      [categoria_id, nombre.trim()]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateSubcategoria(req, res, next) {
  try {
    const { nombre, activo, categoria_id } = req.body;
    const sets = []; const vals = [];
    if (nombre !== undefined)       { sets.push('nombre = ?');       vals.push(nombre.trim()); }
    if (categoria_id !== undefined) { sets.push('categoria_id = ?'); vals.push(categoria_id); }
    if (activo !== undefined)       { sets.push('activo = ?');       vals.push(activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE subcategorias_prod SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Unidades de medida ───────────────────────────────────────────────────────
async function listUnidades(req, res, next) {
  try {
    const cond = condActivo(req);
    const [rows] = await pool.query(
      `SELECT id, nombre, factor_sugerido, activo FROM unidades_medida ${cond ? `WHERE ${cond}` : ''} ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function removeUnidad(req, res, next) {
  try {
    await pool.query('UPDATE unidades_medida SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function createUnidad(req, res, next) {
  try {
    const { nombre, factor_sugerido } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    const [r] = await pool.query(
      'INSERT INTO unidades_medida (nombre, factor_sugerido) VALUES (?, ?) ON DUPLICATE KEY UPDATE activo = 1',
      [nombre.trim(), factor_sugerido ?? null]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
}

async function updateUnidad(req, res, next) {
  try {
    const { nombre, factor_sugerido, activo } = req.body;
    const sets = []; const vals = [];
    if (nombre !== undefined)          { sets.push('nombre = ?');          vals.push(nombre.trim()); }
    if (factor_sugerido !== undefined) { sets.push('factor_sugerido = ?'); vals.push(factor_sugerido); }
    if (activo !== undefined)          { sets.push('activo = ?');          vals.push(activo ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE unidades_medida SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Importación de catálogos de apoyo (preview) ──────────────────────────────
async function importPreview(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const result = parseCatalogosApoyo(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
    if (!result.taxonomia.length && !result.unidades.length) {
      return res.status(400).json({ error: 'No se encontraron columnas FAMILIA o UNIDAD en el archivo' });
    }
    res.json(result);
  } catch (err) { next(err); }
}

// ── Importación de catálogos de apoyo (confirmar) ────────────────────────────
async function importConfirm(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { taxonomia, unidades } = req.body;
    await conn.beginTransaction();

    const famCache = {};
    const catCache = {};
    const subSet = new Set();

    for (const t of (Array.isArray(taxonomia) ? taxonomia : [])) {
      const familiaNombre = norm_(t.familia);
      if (!familiaNombre) continue;

      let famId = famCache[familiaNombre];
      if (!famId) {
        const [r] = await conn.query(
          'INSERT INTO familias (nombre) VALUES (?) ON DUPLICATE KEY UPDATE activo = 1, id = LAST_INSERT_ID(id)',
          [familiaNombre]
        );
        famId = r.insertId;
        famCache[familiaNombre] = famId;
      }

      const categoriaNombre = norm_(t.categoria);
      if (!categoriaNombre) continue;
      const catKey = `${famId}|${categoriaNombre}`;
      let catId = catCache[catKey];
      if (!catId) {
        const [r] = await conn.query(
          'INSERT INTO categorias_prod (familia_id, nombre) VALUES (?, ?) ON DUPLICATE KEY UPDATE activo = 1, id = LAST_INSERT_ID(id)',
          [famId, categoriaNombre]
        );
        catId = r.insertId;
        catCache[catKey] = catId;
      }

      const subNombre = norm_(t.subcategoria);
      if (!subNombre) continue;
      await conn.query(
        'INSERT INTO subcategorias_prod (categoria_id, nombre) VALUES (?, ?) ON DUPLICATE KEY UPDATE activo = 1',
        [catId, subNombre]
      );
      subSet.add(`${catId}|${subNombre}`);
    }

    let unidadesN = 0;
    for (const u of (Array.isArray(unidades) ? unidades : [])) {
      const nombre = norm_(u.unidad);
      if (!nombre) continue;
      await conn.query(
        `INSERT INTO unidades_medida (nombre, factor_sugerido) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE activo = 1, factor_sugerido = VALUES(factor_sugerido)`,
        [nombre, u.factor ?? null]
      );
      unidadesN++;
    }

    await conn.commit();
    res.json({
      ok: true,
      familias: Object.keys(famCache).length,
      categorias: Object.keys(catCache).length,
      subcategorias: subSet.size,
      unidades: unidadesN,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

function norm_(s) { return s == null ? '' : String(s).trim(); }

/** GET /catalogos/import/plantilla → xlsx de ejemplo con el layout que espera el import. */
function plantillaImport(req, res, next) {
  try {
    const wsTax = XLSX.utils.aoa_to_sheet([
      ['FAMILIA', 'CATEGORIA', 'SUBCATEGORIA'],
      ['MATERIAL DE CURACION', 'GASAS Y APOSITOS', 'GASA ESTERIL'],
      ['MATERIAL DE CURACION', 'GASAS Y APOSITOS', 'GASA NO ESTERIL'],
      ['MATERIAL DE CURACION', 'CINTAS Y VENDAS', ''],
      ['EQUIPO MEDICO', '', ''],
    ]);
    const wsUni = XLSX.utils.aoa_to_sheet([
      ['UNIDAD', 'FACTOR'],
      ['PIEZA', 1],
      ['CAJA C/50', 50],
      ['PAQUETE C/10', 10],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsTax, 'TAXONOMIA');
    XLSX.utils.book_append_sheet(wb, wsUni, 'UNIDADES');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_catalogos_apoyo.xlsx"');
    res.send(buf);
  } catch (err) { next(err); }
}

module.exports = {
  listFamilias, createFamilia, updateFamilia, removeFamilia,
  listCategorias, createCategoria, updateCategoria, removeCategoria,
  listSubcategorias, createSubcategoria, updateSubcategoria, removeSubcategoria,
  listUnidades, createUnidad, updateUnidad, removeUnidad,
  importPreview, importConfirm, plantillaImport,
};
