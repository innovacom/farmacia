const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const [rows] = await pool.query(
      `SELECT u.*, j.nombre AS jefe_nombre
       FROM usuarios u
       LEFT JOIN usuarios j ON j.id = u.jefe_id
       WHERE u.email = ? AND u.activo = 1`,
      [email]
    );

    if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const payload = {
      id:          user.id,
      email:       user.email,
      nombre:      user.nombre,
      puesto:      user.puesto,
      rol:         user.rol,
      jefe_id:     user.jefe_id,
      jefe_nombre: user.jefe_nombre,
      empresa_id:  user.empresa_id,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    res.json({ token, user: payload });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json(req.user);
}

module.exports = { login, me };
