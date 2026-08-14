/**
 * marketing.controller.js — Lista de correos capturados por el formulario de
 * boletín en /tienda (tienda.controller.js#suscribir, tabla
 * tienda_suscriptores). Solo lectura: la suscripción en sí es pública y vive
 * en el módulo tienda; este módulo es la vista admin (adminOnly, ver
 * marketing.routes.js — datos de contacto son sensibles).
 */
const { pool } = require('../../config/db');

async function listSuscriptores(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, email, nombre, created_at
         FROM tienda_suscriptores
        WHERE empresa_id = ? AND activo = 1
        ORDER BY created_at DESC`,
      [req.empresaId]
    );
    res.json(rows);
  } catch (err) { next(err); }
}

module.exports = { listSuscriptores };
