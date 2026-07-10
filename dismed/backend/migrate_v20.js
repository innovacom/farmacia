/**
 * Migración v20 — node migrate_v20.js
 * Contabilidad: catálogo de bancos (catálogo de bancos del SAT, Anexo 24).
 *
 * Crea `bancos` con el catálogo oficial (clave SAT, nombre corto, razón social)
 * más dos campos que asigna el usuario: `descripcion` (etiqueta libre) y
 * `cuenta_contable_codigo` (código agrupador SAT, normalmente 102.xx Bancos).
 *
 * El catálogo se siembra con scripts/cargar_bancos.js (lee scripts/bancos.json).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('bancos (tabla)', `
    CREATE TABLE IF NOT EXISTS bancos (
      id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
      clave_sat              VARCHAR(5)   NULL     COMMENT 'Clave del catálogo de bancos del SAT',
      nombre_corto           VARCHAR(100) NOT NULL,
      razon_social           VARCHAR(300) NULL,
      descripcion            VARCHAR(255) NULL     COMMENT 'Etiqueta del usuario (p.ej. cuenta operativa)',
      cuenta_contable_codigo VARCHAR(10)  NULL     COMMENT 'Código agrupador SAT (102.xx Bancos)',
      activo                 TINYINT      NOT NULL DEFAULT 1,
      created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_nombre_corto (nombre_corto),
      KEY idx_clave (clave_sat)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Catálogo de bancos de México (catálogo de bancos del SAT)'
  `);

  console.log('\nMigración v20 terminada. Cargar catálogo: node scripts/cargar_bancos.js');
  process.exit(0);
})();
