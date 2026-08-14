/**
 * Migración v58 — node migrate_v58.js
 * Captura de boletín en el catálogo público /tienda (Fase 3 del plan de
 * tienda web). El formulario del pie de página (BoletinForm.jsx) manda a
 * POST /tienda/suscriptores (tienda.controller.js#suscribir); el admin ve y
 * exporta la lista en Marketing → Suscriptores.
 *
 * UNIQUE (empresa_id, email): re-suscribirse con el mismo correo actualiza
 * la fila existente (ON DUPLICATE KEY UPDATE) en vez de duplicarla.
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
  await run('CREATE tienda_suscriptores', `
    CREATE TABLE IF NOT EXISTS tienda_suscriptores (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id INT UNSIGNED NOT NULL,
      email      VARCHAR(150) NOT NULL,
      nombre     VARCHAR(150) NULL,
      activo     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_empresa_email (empresa_id, email),
      CONSTRAINT fk_suscriptor_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v58 terminada.');
  process.exit(0);
})();
