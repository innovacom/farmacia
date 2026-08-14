/**
 * config/empresa.js — resuelve la única empresa "real" de esta instancia
 * para entrypoints públicos/sin auth (webhook de WhatsApp, catálogo /tienda)
 * que necesitan un empresa_id mas no tienen req.user de dónde tomarlo.
 *
 * "La primera empresa dada de alta" es mala señal (farmacia tiene 2 filas en
 * `empresas`, la operativa —con usuarios y citas— es la id=2, no la id=1):
 * mejor señal es a qué empresa pertenecen los usuarios activos de verdad,
 * que es quien opera la instancia. Movido aquí desde whatsapp.service.js
 * (mismo problema exacto, ahora también lo necesita tienda.controller.js).
 */
const { pool } = require('./db');

async function resolverEmpresaUnica() {
  const [[row]] = await pool.query(
    `SELECT empresa_id FROM usuarios WHERE activo = 1
     GROUP BY empresa_id ORDER BY COUNT(*) DESC LIMIT 1`
  );
  return row?.empresa_id || null;
}

module.exports = { resolverEmpresaUnica };
