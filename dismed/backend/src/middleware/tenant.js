/**
 * tenant.js — Resuelve la empresa (tenant) del usuario autenticado.
 * Deny-by-default: si no se puede determinar una empresa, la petición se
 * rechaza con 403. Se monta DESPUÉS de auth: router.use(auth, tenant).
 *
 * Los JWT emitidos antes de v28 no traen empresa_id -> fallback a BD
 * (transitorio: los tokens expiran en 8h).
 */
const { pool } = require('../config/db');

async function tenantMiddleware(req, res, next) {
  try {
    let empresaId = req.user?.empresa_id;

    if (empresaId === undefined || empresaId === null) {
      const [rows] = await pool.query(
        'SELECT empresa_id FROM usuarios WHERE id = ? AND activo = 1',
        [req.user?.id]
      );
      empresaId = rows.length ? rows[0].empresa_id : null;
    }

    if (!empresaId) {
      return res.status(403).json({ error: 'Usuario sin empresa asignada' });
    }

    req.empresaId = empresaId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = tenantMiddleware;
