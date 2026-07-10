#!/usr/bin/env node
/**
 * scripts/cargar_sat_agrupador.js — Carga el Código Agrupador del SAT (Anexo 24)
 * en la tabla `sat_cuentas_agrupador`.
 *
 * Lee el archivo estático `scripts/sat_agrupador.json` (generado una sola vez
 * desde contabilidad_electronica_Sat.md con parse_sat_agrupador.js --json), de
 * modo que la carga es determinista y no depende del PDF/markdown en el servidor.
 *
 * Idempotente: REPLACE INTO (upsert por código). No borra columnas asignadas en
 * otras tablas; solo refresca el catálogo.
 *
 * Uso:  node scripts/cargar_sat_agrupador.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const DATA = path.resolve(__dirname, 'sat_agrupador.json');

(async () => {
  try {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    if (!Array.isArray(rows) || !rows.length) throw new Error('JSON vacío');

    const values = rows.map((r) => [
      r.codigo, r.nivel, r.naturaleza, r.padre || null, r.rubro, r.nombre,
    ]);

    // REPLACE en lotes (upsert por PK = codigo).
    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const lote = values.slice(i, i + CHUNK);
      const [r] = await pool.query(
        'REPLACE INTO sat_cuentas_agrupador (codigo, nivel, naturaleza, padre, rubro, nombre) VALUES ?',
        [lote]
      );
      total += lote.length;
      void r;
    }

    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM sat_cuentas_agrupador');
    console.log(`Cargadas ${total} cuentas. Total en tabla: ${n}.`);
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
