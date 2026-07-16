const { pool } = require('../../config/db');

async function listAlmacenes(req, res, next) {
  try {
    const estatus = req.query.estatus || 'activos'; // activos | inactivos | todos
    const where = estatus === 'todos' ? '' : `WHERE a.activo = ${estatus === 'inactivos' ? 0 : 1}`;
    const [rows] = await pool.query(
      `SELECT a.id, a.codigo, a.nombre, a.direccion, a.activo,
              (SELECT COUNT(*) FROM ubicaciones u WHERE u.almacen_id = a.id AND u.activo = 1) AS ubicaciones
       FROM almacenes a ${where} ORDER BY a.nombre`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createAlmacen(req, res, next) {
  try {
    const { codigo, nombre, direccion } = req.body;
    if (!codigo?.trim() || !nombre?.trim()) return res.status(400).json({ error: 'codigo y nombre requeridos' });
    const [r] = await pool.query(
      'INSERT INTO almacenes (codigo, nombre, direccion) VALUES (?, ?, ?)',
      [codigo.trim(), nombre.trim(), direccion || null]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un almacén con ese código' });
    next(err);
  }
}

async function updateAlmacen(req, res, next) {
  try {
    const sets = []; const vals = [];
    ['codigo', 'nombre', 'direccion', 'activo'].forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.id);
    await pool.query(`UPDATE almacenes SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removeAlmacen(req, res, next) {
  try {
    await pool.query('UPDATE almacenes SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listUbicaciones(req, res, next) {
  try {
    const estatus = req.query.estatus || 'activos'; // activos | inactivos | todos
    const cond = estatus === 'todos' ? '' : `AND activo = ${estatus === 'inactivos' ? 0 : 1}`;
    const [rows] = await pool.query(
      `SELECT id, almacen_id, codigo, descripcion, tipo, activo
       FROM ubicaciones WHERE almacen_id = ? ${cond} ORDER BY codigo`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function createUbicacion(req, res, next) {
  try {
    const { codigo, descripcion, tipo } = req.body;
    if (!codigo?.trim()) return res.status(400).json({ error: 'codigo requerido' });
    const [r] = await pool.query(
      'INSERT INTO ubicaciones (almacen_id, codigo, descripcion, tipo) VALUES (?, ?, ?, ?)',
      [req.params.id, codigo.trim(), descripcion || null, tipo || 'otro']
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código de ubicación ya existe en el almacén' });
    next(err);
  }
}

async function updateUbicacion(req, res, next) {
  try {
    const sets = []; const vals = [];
    ['codigo', 'descripcion', 'tipo', 'activo'].forEach((f) => {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
    vals.push(req.params.uid);
    await pool.query(`UPDATE ubicaciones SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function removeUbicacion(req, res, next) {
  try {
    await pool.query('UPDATE ubicaciones SET activo = 0 WHERE id = ? AND almacen_id = ?', [req.params.uid, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listAlmacenes, createAlmacen, updateAlmacen, removeAlmacen,
  listUbicaciones, createUbicacion, updateUbicacion, removeUbicacion,
};
