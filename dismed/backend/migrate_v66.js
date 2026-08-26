/**
 * Migración v66 — node migrate_v66.js
 * Contabilidad: RFC de las instituciones bancarias del catálogo `bancos`.
 *
 * El catálogo `bancos` (migrate_v20, fuente SAT/Banxico "Instituciones
 * bancarias participantes SPEI") solo trae nombre corto/razón social — el
 * catálogo oficial NO incluye RFC. Para poder identificar de forma confiable
 * (no por texto de concepto, que viene abreviado e inconsistente) qué CFDI
 * recibidos son de un banco y clasificarlos como gasto financiero/comisión
 * (701.10), se agrega `bancos.rfc` — se llena cruzando el nombre del catálogo
 * contra los RFC REALES de `cfdi_repositorio` (autoritativos, validados por el
 * PAC/SAT al timbrar) con `scripts/cruzar_rfc_bancos.js --guardar`.
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('bancos.rfc',
    "ALTER TABLE bancos ADD COLUMN IF NOT EXISTS rfc VARCHAR(13) NULL " +
    "COMMENT 'RFC real del banco (cruzado contra cfdi_repositorio, ver scripts/cruzar_rfc_bancos.js) — el catálogo SAT/Banxico origen no trae RFC' " +
    "AFTER razon_social");
  await run('bancos.ix_rfc', 'ALTER TABLE bancos ADD INDEX IF NOT EXISTS ix_rfc (rfc)');

  console.log('\nMigración v66 terminada. Ahora corre: node scripts/cruzar_rfc_bancos.js --guardar');
  process.exit(0);
})();
