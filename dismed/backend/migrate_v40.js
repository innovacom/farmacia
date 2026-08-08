/**
 * Migración v40 — node migrate_v40.js
 * Recordatorio de confirmación de citas: agrega el estado "confirmada" a
 * pos_citas para que el POS de venta pueda avisarle al empleado cuáles citas
 * de hoy/mañana siguen sin confirmar con el paciente (por teléfono o
 * WhatsApp manual — la integración con la API oficial de WhatsApp queda
 * pendiente de la verificación de negocio en Meta Business Manager).
 *
 * Idempotente: ADD COLUMN envuelto en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('pos_citas +confirmada', `
    ALTER TABLE pos_citas ADD COLUMN confirmada TINYINT(1) NOT NULL DEFAULT 0
      COMMENT 'el paciente confirmó que sí asistirá (llamada/WhatsApp manual)' AFTER estatus`);
  await run('pos_citas +confirmada_en', `
    ALTER TABLE pos_citas ADD COLUMN confirmada_en DATETIME NULL AFTER confirmada`);
  await run('pos_citas +confirmada_por', `
    ALTER TABLE pos_citas ADD COLUMN confirmada_por INT UNSIGNED NULL AFTER confirmada_en`);
  await run('fk_cita_confirma', `
    ALTER TABLE pos_citas
      ADD CONSTRAINT fk_cita_confirma FOREIGN KEY (confirmada_por) REFERENCES usuarios(id)`);

  console.log('\nMigración v40 terminada.');
  process.exit(0);
})();
