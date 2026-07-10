/**
 * migrate_clientes_rfc_no_unique.js — Convierte el índice UNIQUE de clientes.rfc
 * en un índice normal. Razón de negocio: distintas SUCURSALES de un mismo cliente
 * comparten el RFC (p.ej. PEMEX), así que el RFC no puede ser único. Cada sucursal
 * es un cliente independiente con sus propias cotizaciones.
 *
 * Idempotente: si el índice ya no es único, no hace nada.
 *   node scripts/migrate_clientes_rfc_no_unique.js
 */
const { pool } = require('../src/config/db');

(async () => {
  const conn = await pool.getConnection();
  try {
    const [idx] = await conn.query(
      `SHOW INDEX FROM clientes WHERE Column_name = 'rfc'`
    );
    const unique = idx.find((i) => i.Non_unique === 0);
    if (!unique) {
      console.log('clientes.rfc ya NO es único. Nada que hacer.');
      return;
    }
    console.log(`Quitando índice UNIQUE '${unique.Key_name}' de clientes.rfc...`);
    await conn.query(`ALTER TABLE clientes DROP INDEX \`${unique.Key_name}\``);
    // recrear como índice normal si no existe otro sobre rfc
    const [idx2] = await conn.query(`SHOW INDEX FROM clientes WHERE Column_name = 'rfc'`);
    if (!idx2.length) {
      await conn.query(`ALTER TABLE clientes ADD INDEX idx_cliente_rfc (rfc)`);
      console.log('Índice normal idx_cliente_rfc creado.');
    }
    console.log('Listo. clientes.rfc ahora admite duplicados (sucursales).');
  } catch (e) {
    console.error('FALLO:', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
