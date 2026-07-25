/**
 * Migración v36 — node migrate_v36.js
 * Campo faltante para imprimir la receta con el formato de hoja membretada
 * (folio, institución/especialidad/nombre del médico, Céd. Prof., S.S.A. y
 * teléfono) que pidió el usuario: falta el registro sanitario S.S.A. en el
 * catálogo de médicos (cedula_profesional y telefono ya existían desde
 * migrate_v28).
 *
 * Idempotente: ADD COLUMN envuelto en run() (columna ya existente -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('medicos +registro_ssa', `
    ALTER TABLE medicos ADD COLUMN registro_ssa VARCHAR(20) NULL
      COMMENT 'Registro sanitario S.S.A., se imprime en la receta' AFTER cedula_profesional`);

  console.log('\nMigración v36 terminada.');
  process.exit(0);
})();
