/**
 * Migración v17 — node migrate_v17.js
 * Configuración del sistema editable por administradores (clave/valor).
 *
 * Primer uso: ventanas de vigencia de precios SEPARADAS
 *   - vigencia_catalogo_meses (def. 11): antigüedad máx. de un precio de catálogo
 *     para darlo por válido; si es mayor se busca el precio.
 *   - vigencia_web_meses (def. 4): antigüedad máx. de un precio guardado de una
 *     búsqueda web previa para reutilizarlo; si es mayor se vuelve a buscar.
 *
 * Idempotente: CREATE IF NOT EXISTS + INSERT IGNORE (no pisa valores ya editados).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('configuracion (tabla)', `
    CREATE TABLE IF NOT EXISTS configuracion (
      clave       VARCHAR(60)   NOT NULL,
      valor       VARCHAR(255)  NOT NULL,
      descripcion VARCHAR(255)  NULL,
      updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (clave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Parámetros del sistema editables por administradores'
  `);

  // Semillas (INSERT IGNORE: si el admin ya cambió el valor, no se sobreescribe).
  await run('seed vigencia_catalogo_meses=11', `
    INSERT IGNORE INTO configuracion (clave, valor, descripcion)
    VALUES ('vigencia_catalogo_meses', '11',
            'Meses de validez de un precio del catálogo de proveedores')
  `);
  await run('seed vigencia_web_meses=4', `
    INSERT IGNORE INTO configuracion (clave, valor, descripcion)
    VALUES ('vigencia_web_meses', '4',
            'Meses de validez de un precio guardado de una búsqueda web')
  `);

  console.log('\nMigración v17 terminada.');
  process.exit(0);
})();
