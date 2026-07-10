/**
 * Migración v27 — node migrate_v27.js
 * Agrega 'batch' al ENUM cfdi_descargas.origen. La "Carga histórica batch"
 * (sat.descarga.service.js#programarBatch) inserta cada solicitud con
 * origen='batch', pero el ENUM solo admitía 'manual','automatico','estatus'
 * (migrate_v14) → INSERT fallaba con "Data truncated for column 'origen'" y
 * ninguna fila llegaba a la bitácora (el error se registraba en consola pero
 * la respuesta HTTP ya se había enviado con éxito).
 *
 * Idempotente: MODIFY COLUMN se puede re-ejecutar sin efecto adicional.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cfdi_descargas.origen +batch',
    `ALTER TABLE cfdi_descargas
       MODIFY COLUMN origen ENUM('manual','automatico','estatus','batch') NOT NULL DEFAULT 'manual'`);

  console.log('\nMigración v27 terminada.');
  process.exit(0);
})();
