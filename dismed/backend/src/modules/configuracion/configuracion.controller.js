/**
 * configuracion.controller.js — Lectura/edición de parámetros del sistema.
 * Por ahora: ventanas de vigencia de precios (catálogo y web).
 * Lectura: cualquier usuario autenticado. Edición: solo admin (ver routes).
 */
const { pool } = require('../../config/db');
const precios = require('../../config/precios');

// Parámetros editables y sus límites de validación.
const META = {
  vigencia_catalogo_meses: { label: 'Vigencia de precios de catálogo (meses)', min: 1, max: 120 },
  vigencia_web_meses:      { label: 'Vigencia de precios de búsqueda web (meses)', min: 1, max: 120 },
};

/** GET /configuracion → { vigencia_catalogo_meses, vigencia_web_meses } */
async function get(req, res, next) {
  try {
    res.json(await precios.getVigencias());
  } catch (err) { next(err); }
}

/** PUT /configuracion (admin) → guarda los valores enviados y devuelve el estado final. */
async function update(req, res, next) {
  try {
    const updates = {};
    for (const clave of Object.keys(META)) {
      if (req.body[clave] === undefined || req.body[clave] === '') continue;
      const n = parseInt(req.body[clave], 10);
      const { label, min, max } = META[clave];
      if (!Number.isInteger(n) || n < min || n > max) {
        return res.status(400).json({ error: `${label}: debe ser un entero entre ${min} y ${max}` });
      }
      updates[clave] = n;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No se enviaron valores válidos para actualizar' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [clave, valor] of Object.entries(updates)) {
        await conn.query(
          `INSERT INTO configuracion (clave, valor, descripcion)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
          [clave, String(valor), META[clave].label]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    precios.aplicar(updates); // refrescar la copia en memoria
    res.json(await precios.getVigencias());
  } catch (err) { next(err); }
}

module.exports = { get, update };
