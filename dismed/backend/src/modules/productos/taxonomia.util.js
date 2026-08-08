// Resuelve (o crea) un id de taxonomía/unidad usando un cache en memoria (por transacción).
// Compartido entre el import de catálogo (productos.controller.js) y la carga automática
// de facturas (inventario/facturas.controller.js), que también da de alta productos nuevos.
async function resolverId(conn, cache, tabla, whereCols, whereVals, insertCols, insertVals) {
  const key = tabla + '|' + whereVals.join('|');
  if (cache[key]) return cache[key];
  const wsql = whereCols.map((c) => `${c} = ?`).join(' AND ');
  const [[row]] = await conn.query(`SELECT id FROM ${tabla} WHERE ${wsql} LIMIT 1`, whereVals);
  if (row) { cache[key] = row.id; return row.id; }
  const [r] = await conn.query(
    `INSERT INTO ${tabla} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    insertVals
  );
  cache[key] = r.insertId;
  return r.insertId;
}

module.exports = { resolverId };
