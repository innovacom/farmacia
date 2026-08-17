const jwt = require('jsonwebtoken');

// Rutas alcanzables aunque el token traiga debe_cambiar_password=true (ver
// auth.controller.js#cambiarPassword). Sin esto, la bandera solo era un
// aviso para la UI: quien llamara al API directo con el token seguía
// operando el sistema entero sin cambiar la contraseña pendiente.
const RUTAS_PERMITIDAS_CON_CAMBIO_PENDIENTE = new Set(['/api/auth/me', '/api/auth/cambiar-password']);

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.slice(7);
  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const ruta = req.originalUrl.split('?')[0];
  if (user.debe_cambiar_password && !RUTAS_PERMITIDAS_CON_CAMBIO_PENDIENTE.has(ruta)) {
    return res.status(403).json({ error: 'Debes cambiar tu contraseña antes de continuar', debe_cambiar_password: true });
  }

  req.user = user;
  next();
}

module.exports = authMiddleware;
