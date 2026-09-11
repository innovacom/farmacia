/**
 * Migración v72 — node migrate_v72.js
 * Logo de institución por médico: se imprime en el cuerpo de la receta
 * (dismed/backend/src/modules/expediente/receta.pdf.generator.js) en vez del
 * caduceo genérico fijo, cuando el médico tiene uno cargado. Se sube vía
 * POST /api/pos/medicos/:id/logo (mismo patrón que el logo de empresa en
 * empresas.routes.js) y se guarda como ruta relativa a uploads/medicos/.
 *
 * Idempotente: ADD COLUMN envuelto en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('medicos +institucion_logo',
    "ALTER TABLE medicos ADD COLUMN institucion_logo VARCHAR(255) NULL " +
    "COMMENT 'ruta relativa en uploads/medicos/<id>/, logo de la institucion impreso en el cuerpo de la receta'");

  console.log('\nMigración v72 terminada.');
  process.exit(0);
})();
