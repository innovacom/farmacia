/**
 * Migración v14 — node migrate_v14.js
 * Convierte la bitácora `cfdi_descargas` en soporte para DOS tipos de solicitud:
 *   - request_type='xml'      → descarga los XML (comportamiento original)
 *   - request_type='metadata' → descarga la metadata (trae el Estatus vigente/cancelado)
 *                               y reconcilia el estatus de los comprobantes guardados.
 *
 * Antes, la reconciliación de estatus corría "en memoria" sin registrarse en la
 * bitácora y sin poder reanudarse; para rangos amplios el SAT no terminaba a tiempo
 * y no se veía nada. Ahora es un job más, visible y reanudable por el cron.
 *
 * Idempotente: detecta si la columna/valor ya existe.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

async function columnExists(table, column) {
  const [r] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]
  );
  return r.length > 0;
}

(async () => {
  // request_type: distingue descarga de XML vs reconciliación por metadata.
  if (await columnExists('cfdi_descargas', 'request_type')) {
    console.log('INFO cfdi_descargas.request_type ya existe');
  } else {
    await run('cfdi_descargas.request_type',
      `ALTER TABLE cfdi_descargas
         ADD COLUMN request_type ENUM('xml','metadata') NOT NULL DEFAULT 'xml'
         COMMENT 'xml=descarga comprobantes; metadata=reconcilia estatus' AFTER tipo`);
  }

  // origen: agrega 'estatus' (jobs creados por la reconciliación de estatus).
  await run('cfdi_descargas.origen +estatus',
    `ALTER TABLE cfdi_descargas
       MODIFY COLUMN origen ENUM('manual','automatico','estatus') NOT NULL DEFAULT 'manual'`);

  console.log('\nMigración v14 terminada.');
  process.exit(0);
})();
