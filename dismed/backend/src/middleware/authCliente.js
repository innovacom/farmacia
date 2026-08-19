/**
 * authCliente.js — Sesión de CLIENTE de la tienda web (/tienda/cuenta),
 * completamente aparte de middleware/auth.js (staff). Nunca asigna
 * `req.user` (así ningún middleware de staff, como tenant.js o
 * requirePermiso, podría confundir una sesión de cliente con una de
 * empleado) — usa `req.cliente = { id, empresa_id, nombre }`.
 *
 * El token se firma en tienda.cuenta.service.js#firmarTokenCliente con
 * `audience: 'tienda-cliente'` y `tipo: 'cliente_tienda'`; aquí se exigen
 * ambos como defensa en profundidad (el filtro real que evita que este
 * token abra rutas de staff vive en middleware/auth.js).
 */
const jwt = require('jsonwebtoken');

function authCliente(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sesión requerida' });
  }
  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { audience: 'tienda-cliente' });
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
  if (payload.tipo !== 'cliente_tienda' || !payload.cliente_id || !payload.empresa_id) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }

  req.cliente = { id: payload.cliente_id, empresa_id: payload.empresa_id, nombre: payload.nombre };
  next();
}

// Variante para rutas públicas donde estar logueado es opcional (checkout de
// invitado vs. checkout de cliente con cuenta, ver tienda.checkout.controller.js):
// si hay un token de cliente válido lo decodifica en req.cliente; cualquier
// otro caso (sin token, token de staff, expirado) sigue de largo como
// invitado — NUNCA responde 401 aquí.
function authClienteOpcional(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { audience: 'tienda-cliente' });
    if (payload.tipo === 'cliente_tienda' && payload.cliente_id && payload.empresa_id) {
      req.cliente = { id: payload.cliente_id, empresa_id: payload.empresa_id, nombre: payload.nombre };
    }
  } catch { /* invitado */ }
  next();
}

module.exports = authCliente;
module.exports.authClienteOpcional = authClienteOpcional;
