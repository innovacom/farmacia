const { pool } = require('../../config/db');

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

module.exports = {
  listFamilias, createFamilia, updateFamilia, removeFamilia,
  listCategorias, createCategoria, updateCategoria, removeCategoria,
  listSubcategorias, createSubcategoria, updateSubcategoria, removeSubcategoria,
  listUnidades, createUnidad, updateUnidad, removeUnidad,
};
