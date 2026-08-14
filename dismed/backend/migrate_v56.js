/**
 * Migración v56 — node migrate_v56.js
 * Pie de página de la tienda pública (/tienda): cada sucursal publicada
 * muestra dirección, teléfono, horario y un mapa embebido.
 *
 * - latitud/longitud: coordenadas del punto exacto de la sucursal. Alimentan
 *   un <iframe> de maps.google.com/maps?q=lat,lng&output=embed — embed SIN
 *   API key a propósito (la Embed API de Google exige key + cuenta de
 *   facturación; esto no).
 * - publicar_web: misma bandera y misma semántica que productos.publicar_web
 *   — activo=1 NO implica público. Default 0: publicar la dirección física
 *   de una sucursal debe ser un acto deliberado, y la instancia dismed tiene
 *   "sucursales" que en realidad son almacenes internos.
 *   Sin backfill: el admin la enciende en Pos → Sucursales.
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
  await run('sucursales.latitud',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS latitud DECIMAL(10,7) NULL
       COMMENT 'Latitud del punto exacto (mapa del pie de /tienda); NULL = sin mapa' AFTER telefono`);
  await run('sucursales.longitud',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS longitud DECIMAL(10,7) NULL
       COMMENT 'Longitud del punto exacto (mapa del pie de /tienda); NULL = sin mapa' AFTER latitud`);
  await run('sucursales.publicar_web',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS publicar_web TINYINT(1) NOT NULL DEFAULT 0
       COMMENT 'Mostrar esta sucursal en el pie del catálogo público /tienda (distinta de activo)' AFTER longitud`);

  console.log('\nMigración v56 terminada.');
  console.log('Recuerda marcar "Mostrar en la tienda en línea" en Pos → Sucursales.');
  process.exit(0);
})();
