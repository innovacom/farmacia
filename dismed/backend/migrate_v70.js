/**
 * Migración v70 — node migrate_v70.js
 * CFDI · carga manual de XML descargados por otros medios.
 *
 * Hasta ahora `cfdi_repositorio.origen` solo admitía 'sat' (descarga masiva con
 * e.firma), 'legacy' (import del sistema anterior) y 'sistema'. Se agrega 'manual'
 * para los XML que el contador sube uno por uno en Descargas CFDI → "Subir XML"
 * (facturas que la descarga masiva no trajo: emitidas a un RFC distinto, de un
 * periodo aún no descargado, etc.). El parser y el motor de pólizas los tratan
 * igual que los de 'sat' (mismo parseCfdi / guardarComprobante).
 *
 * Idempotente: MODIFY COLUMN es declarativo (deja el ENUM en el estado final).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cfdi_repositorio.origen += manual',
    "ALTER TABLE cfdi_repositorio " +
    "MODIFY COLUMN origen ENUM('sat','legacy','sistema','manual') NOT NULL DEFAULT 'sat'");

  console.log('\nMigración v70 terminada.');
  process.exit(0);
})();
