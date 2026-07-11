const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { PERMISSIONABLE_KEYS } = require('./menu.keys');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.puesto, u.email, u.rol, u.activo,
              u.jefe_id, j.nombre AS jefe_nombre,
              u.empresa_id, e.nombre AS empresa_nombre
       FROM usuarios u
       LEFT JOIN usuarios j ON j.id = u.jefe_id
       LEFT JOIN empresas e ON e.id = u.empresa_id
       ORDER BY u.nombre`
    );
    res.json(rows);
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try {
    const [[u]] = await pool.query(
      `SELECT u.id, u.nombre, u.puesto, u.email, u.rol, u.activo,
              u.jefe_id, j.nombre AS jefe_nombre,
              u.empresa_id, e.nombre AS empresa_nombre
       FROM usuarios u
       LEFT JOIN usuarios j ON j.id = u.jefe_id
       LEFT JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = ?`,
      [req.params.id]
    );
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(u);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { nombre, puesto, email, password, rol, jefe_id, empresa_id } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'nombre, email y contraseña son requeridos' });
    }
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, puesto, email, password_hash, rol, jefe_id, empresa_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, puesto || null, email, hash, rol || 'operador', jefe_id || null, empresa_id || 1]
    );
    res.status(201).json({ id: r.insertId, nombre, email });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { nombre, puesto, email, rol, jefe_id, activo, password, empresa_id } = req.body;

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE usuarios SET nombre=?, puesto=?, email=?, rol=?, jefe_id=?, activo=?, empresa_id=?, password_hash=?
         WHERE id = ?`,
        [nombre, puesto || null, email, rol || 'operador',
         jefe_id || null, activo !== undefined ? activo : 1, empresa_id || 1, hash, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE usuarios SET nombre=?, puesto=?, email=?, rol=?, jefe_id=?, activo=?, empresa_id=?
         WHERE id = ?`,
        [nombre, puesto || null, email, rol || 'operador',
         jefe_id || null, activo !== undefined ? activo : 1, empresa_id || 1, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    }
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    await pool.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ---- Permisos de menú ----------------------------------------------------

// Permisos efectivos del usuario autenticado (lo consume el frontend para
// filtrar menú y rutas). Admin: acceso total → se entregan todas las claves.
async function myPermisos(req, res, next) {
  try {
    if (req.user.rol === 'admin') {
      return res.json({ rol: 'admin', permisos: PERMISSIONABLE_KEYS });
    }
    const [rows] = await pool.query(
      'SELECT menu_key FROM usuarios_permisos WHERE usuario_id = ?', [req.user.id]
    );
    res.json({ rol: req.user.rol, permisos: rows.map((r) => r.menu_key) });
  } catch (err) { next(err); }
}

// Permisos configurados de un usuario (admin). Devuelve solo las claves operables.
async function getPermisos(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT menu_key FROM usuarios_permisos WHERE usuario_id = ?', [req.params.id]
    );
    res.json(rows.map((r) => r.menu_key));
  } catch (err) { next(err); }
}

// Reemplaza el set completo de permisos de un usuario (admin).
async function setPermisos(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const [[u]] = await conn.query('SELECT id, rol FROM usuarios WHERE id = ?', [req.params.id]);
    if (!u) { conn.release(); return res.status(404).json({ error: 'Usuario no encontrado' }); }

    // Solo claves válidas; se ignora cualquier cosa fuera del catálogo.
    const entrada = Array.isArray(req.body?.permisos) ? req.body.permisos : [];
    const permisos = [...new Set(entrada.filter((k) => PERMISSIONABLE_KEYS.includes(k)))];

    await conn.beginTransaction();
    await conn.query('DELETE FROM usuarios_permisos WHERE usuario_id = ?', [u.id]);
    if (permisos.length) {
      await conn.query(
        'INSERT INTO usuarios_permisos (usuario_id, menu_key) VALUES ?',
        [permisos.map((k) => [u.id, k])]
      );
    }
    await conn.commit();
    res.json({ ok: true, permisos });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { list, getById, create, update, remove, myPermisos, getPermisos, setPermisos };
