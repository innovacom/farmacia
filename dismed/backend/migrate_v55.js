/**
 * Migración v55 — node migrate_v55.js
 *
 * Activa en el catálogo público /tienda todos los productos activos del
 * catálogo (publicar_web=1). DISMED no tiene un campo dedicado que distinga
 * "productos de farmacia" del resto — toda la tabla `productos` es el
 * catálogo único de la farmacia (ver PROPUESTA_POS_FARMACIA.md: "Mismo
 * catálogo — no se duplica"), así que "activar todos los productos de
 * farmacia" equivale a publicar todo lo que está activo=1.
 *
 * El fallback de imagen (logo Innovacom para productos sin foto) se resuelve
 * en el frontend (Catalogo.jsx / DetalleProducto.jsx), no aquí, para no
 * escribir un nombre de archivo falso en 1600+ filas de `imagen_url` — así
 * el campo sigue significando "hay foto real" y el placeholder desaparece
 * solo en cuanto se suba una foto de verdad.
 *
 * Idempotente: UPDATE con WHERE, seguro de correr más de una vez.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
  const [result] = await pool.query(
    `UPDATE productos SET publicar_web = 1 WHERE activo = 1 AND publicar_web = 0`
  );
  console.log(`OK  productos activados en /tienda: ${result.affectedRows}`);

  console.log('\nMigración v55 terminada.');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
