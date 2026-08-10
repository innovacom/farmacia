/**
 * Migración v52 — node migrate_v52.js
 * Entrega 1 del plan de tienda web (catálogo público + "Pedir por WhatsApp",
 * ver memoria project_tienda_web_farmacia): agrega a `productos` la foto y la
 * bandera de publicación en el catálogo público.
 *
 * `publicar_web` es DISTINTA de `vendible` (esa gobierna el mostrador/POS) —
 * un producto puede venderse en mostrador sin exponerse en la tienda pública
 * (o viceversa, aunque lo normal será marcarlas juntas). Default 0: nada se
 * publica solo hasta migrar; el admin decide qué mostrar producto por producto.
 *
 * Idempotente: ALTER envuelto en run() (error -> INFO, ya existe la columna).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('productos +imagen_url', `
    ALTER TABLE productos ADD COLUMN imagen_url VARCHAR(255) NULL AFTER especificacion`);

  await run('productos +publicar_web', `
    ALTER TABLE productos ADD COLUMN publicar_web TINYINT(1) NOT NULL DEFAULT 0 AFTER imagen_url`);

  console.log('\nMigración v52 terminada.');
  process.exit(0);
})();
