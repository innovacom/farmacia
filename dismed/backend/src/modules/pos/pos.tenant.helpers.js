/**
 * pos.tenant.helpers.js — Acceso a filas SIEMPRE acotado por empresa.
 * Regla del módulo POS: ningún controller/servicio consulta por id "crudo";
 * un id de otro tenant es indistinguible de inexistente (404), para no
 * filtrar existencia de datos entre empresas.
 */

/**
 * SELECT * FROM `tabla` WHERE id = ? AND empresa_id = ? (FOR UPDATE opcional).
 * Lanza error 404 si no hay fila. `tabla` debe venir de código propio,
 * nunca de entrada del usuario (se interpola en el SQL).
 */
async function getScoped(conn, tabla, id, empresaId, { forUpdate = false } = {}) {
  const [rows] = await conn.query(
    `SELECT * FROM ${tabla} WHERE id = ? AND empresa_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, empresaId]
  );
  if (!rows.length) {
    const err = new Error('No encontrado');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

module.exports = { getScoped };
