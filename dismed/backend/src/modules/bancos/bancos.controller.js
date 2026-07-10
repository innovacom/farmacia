const { pool } = require('../../config/db');

// Campos editables de un banco.
const FIELDS = ['clave_sat', 'nombre_corto', 'razon_social', 'descripcion', 'cuenta_contable_codigo', 'activo'];

// GET /bancos?q=&activo=0|1   Lista con búsqueda y filtro de activo.
async function list(req, res, next) {
  try {
    const where = [];
    const vals = [];
    if (req.query.q && req.query.q.trim()) {
      const like = `%${req.query.q.trim()}%`;
      where.push('(b.nombre_corto LIKE ? OR b.razon_social LIKE ? OR b.clave_sat LIKE ? OR b.descripcion LIKE ?)');
      vals.push(like, like, like, like);
    }
    if (req.query.activo === '1') where.push('b.activo = 1');
    else if (req.query.activo === '0') where.push('b.activo = 0');
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT b.id, b.clave_sat, b.nombre_corto, b.razon_social, b.descripcion,
              b.cuenta_contable_codigo, b.activo,
              c.nombre AS cuenta_nombre
       FROM bancos b
       LEFT JOIN sat_cuentas_agrupador c ON c.codigo = b.cuenta_contable_codigo
       ${w}
       ORDER BY (b.clave_sat IS NULL), b.clave_sat, b.nombre_corto`,
      vals
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[row]] = await pool.query('SELECT * FROM bancos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Banco no encontrado' });
    res.json(row);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { nombre_corto } = req.body;
    if (!nombre_corto || !nombre_corto.trim()) {
      return res.status(400).json({ error: 'nombre_corto requerido' });
    }
    const cols = []; const ph = []; const vals = [];
    FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) { cols.push(f); ph.push('?'); vals.push(req.body[f] === '' ? null : req.body[f]); }
    });
    const [r] = await pool.query(
      `INSERT INTO bancos (${cols.join(', ')}) VALUES (${ph.join(', ')})`, vals
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un banco con ese nombre corto' });
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const sets = []; const vals = [];
    FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] === '' ? null : req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    vals.push(req.params.id);
    await pool.query(`UPDATE bancos SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un banco con ese nombre corto' });
    next(err);
  }
}

// Baja lógica.
async function remove(req, res, next) {
  try {
    await pool.query('UPDATE bancos SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove };
