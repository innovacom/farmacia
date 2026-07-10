/**
 * legacy_extract.js — FASE 1 de la importación histórica (corre en DEV).
 *
 * Lee el sistema anterior (innova99_innovacom) y vuelca las tablas necesarias a
 * JSON en backend/data/legacy/. Estos archivos se transfieren al VPS, donde
 * legacy_load.js los carga en las tablas vivas de dismed_db.
 *
 * Por qué dos fases: el host antiguo solo es accesible desde la IP de desarrollo
 * y dismed_db solo desde el VPS; ninguna máquina alcanza ambas BD a la vez.
 *
 * Uso:  node scripts/legacy_extract.js
 */
const fs = require('fs');
const path = require('path');
const { createOldPool } = require('../src/config/old-db');

const OUT_DIR = path.join(__dirname, '..', 'data', 'legacy');

// Tablas a extraer. `cotizacion_Detalle` excluye `foto` (mediumblob) por tamaño.
const QUERIES = {
  cotizacion_encabezado: 'SELECT * FROM cotizacion_encabezado',
  cotizacion_detalle: `SELECT cotizacion, partida, descripcion, cantidad_solicitada,
      Precio_referencia, observacion_cliente, unidad_medida, iva, precio_compra,
      proveedor, clave_cliente, ean, codigo_innovacom, codigo_gobierno, id_proveedor
    FROM cotizacion_Detalle`,
  cotizacion_detalle_proveedor: 'SELECT * FROM cotizacion_detalle_proveedor',
  clientes: 'SELECT * FROM clientes',
  usuarios: 'SELECT * FROM Usuarios',
  proveedores: 'SELECT * FROM Proveedores',
};

// Recorta espacios de todos los strings (la BD antigua usa CHAR con padding).
function trimRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
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
