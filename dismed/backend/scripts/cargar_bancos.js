#!/usr/bin/env node
/**
 * scripts/cargar_bancos.js — Siembra el catálogo de bancos en la tabla `bancos`
 * desde el archivo estático scripts/bancos.json (generado con parse_bancos.js).
 *
 * Usa INSERT IGNORE sobre la clave única (nombre_corto): en recargas NO pisa los
 * campos que edita el usuario (descripcion, cuenta_contable_codigo, activo); sólo
 * agrega bancos que falten.
 *
 * Uso:  node scripts/cargar_bancos.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const DATA = path.resolve(__dirname, 'bancos.json');

(async () => {
  try {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) throw new Error('JSON vacío');

    const values = rows.map((b) => [b.clave_sat || null, b.nombre_corto, b.razon_social || null]);
    const [r] = await pool.query(
      'INSERT IGNORE INTO bancos (clave_sat, nombre_corto, razon_social) VALUES ?',
      [values]
    );

    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM bancos');
    console.log(`Bancos en JSON: ${rows.length}. Nuevos insertados: ${r.affectedRows}. Total en tabla: ${n}.`);
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
