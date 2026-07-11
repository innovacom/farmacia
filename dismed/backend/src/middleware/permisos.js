/**
 * permisos.js — Autorización server-side por clave de menú.
 * requirePermiso('pos-venta') deja pasar a admins y a operadores que tengan
 * esa clave en usuarios_permisos (la misma tabla que alimenta el menú del
 * frontend, ver usuarios.controller.js#myPermisos). Hasta v28 los permisos
 * solo se aplicaban en el frontend; el POS maneja efectivo, así que aquí
 * se cierran también en el servidor.
 */
const { pool } = require('../config/db');

function requirePermiso(menuKey) {
  return async function (req, res, next) {
    try {
      if (req.user?.rol === 'admin') return next();
      const [rows] = await pool.query(
        'SELECT 1 FROM usuarios_permisos WHERE usuario_id = ? AND menu_key = ? LIMIT 1',
        [req.user?.id, menuKey]
      );
      if (!rows.length) {
        return res.status(403).json({ error: 'Sin permiso para esta operación' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermiso };
