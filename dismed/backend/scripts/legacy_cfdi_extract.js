/**
 * legacy_cfdi_extract.js — FASE 1 de la importación histórica de CFDI (corre en DEV).
 *
 * Lee las tablas de CFDI del sistema anterior (innova99_innovacom) y las vuelca a
 * JSON en backend/data/legacy_cfdi/. Esos archivos se transfieren al VPS, donde
 * legacy_cfdi_load.js los carga en cfdi_repositorio / cfdi_repositorio_conceptos.
 *
 * (Mismo patrón que legacy_extract.js: el host antiguo solo es accesible desde la
 * IP de desarrollo y dismed_db solo desde el VPS.)
 *
 * Uso:  node scripts/legacy_cfdi_extract.js
 */
const fs = require('fs');
const path = require('path');
const { createOldPool } = require('../src/config/old-db');

const OUT_DIR = path.join(__dirname, '..', 'data', 'legacy_cfdi');

const QUERIES = {
  // Encabezados
  cfdi_emitido:        'SELECT * FROM Cfdi_Emitido',          // emitidos por INNOVACOM
  cfdi_recibido:       'SELECT * FROM Cfdi_Encabezado',       // recibidos (proveedores)
  cfdi_pagos:          'SELECT * FROM Cfdi_Pagos',            // complementos de pago
  // Detalle (conceptos)
  cfdi_emitido_detalle: 'SELECT * FROM Cfdi_Emitido_Detalle',
  cfdi_recibido_detalle: 'SELECT * FROM Cfdi_Detalle',
};

function trimRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pool = createOldPool();
  const manifest = {};
  try {
    for (const [name, sql] of Object.entries(QUERIES)) {
      process.stdout.write(`Extrayendo ${name} ... `);
      const [rows] = await pool.query(sql);
      const data = rows.map(trimRow);
      const file = path.join(OUT_DIR, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(data), 'utf8');
      manifest[name] = data.length;
      console.log(`${data.length} filas → ${path.basename(file)}`);
    }
    manifest._extracted_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log('\nListo. Manifiesto:', JSON.stringify(manifest));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
