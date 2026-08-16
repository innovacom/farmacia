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
      debe_cambiar_password: !!user.debe_cambiar_password,
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

// Autoservicio: cambia la contraseña propia (a diferencia de PUT /usuarios/:id,
// que es admin-only). Se usa tanto para el cambio forzado en el primer login
// (seed.js siembra el admin con debe_cambiar_password=1) como para que
// cualquier usuario cambie su contraseña voluntariamente. Reemite el token
// para que el frontend limpie el flag sin tener que volver a hacer login.
async function cambiarPassword(req, res, next) {
  try {
    const { passwordActual, passwordNuevo } = req.body;
    if (!passwordActual || !passwordNuevo) {
      return res.status(400).json({ error: 'passwordActual y passwordNuevo son requeridos' });
    }
    if (passwordNuevo.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }

    const [rows] = await pool.query(
      `SELECT u.*, j.nombre AS jefe_nombre
       FROM usuarios u
       LEFT JOIN usuarios j ON j.id = u.jefe_id
       WHERE u.id = ? AND u.activo = 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = rows[0];

    const valid = await bcrypt.compare(passwordActual, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'La contraseña actual no es correcta' });

    const nuevoHash = await bcrypt.hash(passwordNuevo, 10);
    await pool.query(
      'UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?',
      [nuevoHash, user.id]
    );

    const payload = {
      id: user.id, email: user.email, nombre: user.nombre, puesto: user.puesto,
      rol: user.rol, jefe_id: user.jefe_id, jefe_nombre: user.jefe_nombre,
      empresa_id: user.empresa_id, debe_cambiar_password: false,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });
    res.json({ token, user: payload });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, me, cambiarPassword };
