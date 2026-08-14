/**
 * Migración v57 — node migrate_v57.js
 * Datos sanitarios COFEPRIS de cada sucursal, para mostrarse en el pie del
 * catálogo público /tienda (Fase 2 del plan de tienda web). Un registro
 * COFEPRIS (Aviso de Funcionamiento, responsable sanitario) es por
 * establecimiento físico, no por razón social — por eso vive en `sucursales`
 * y no en `empresas`, igual que direccion/telefono/latitud (migrate_v56).
 *
 * - sucursales.responsable_sanitario: nombre del responsable sanitario/QFB.
 * - sucursales.cedula_responsable_sanitario: cédula profesional de ese responsable.
 * - sucursales.licencia_sanitaria: número de Aviso de Funcionamiento COFEPRIS.
 *
 * Sin backfill y sin default: son datos reales que solo el admin puede
 * capturar (Pos → Sucursales); mientras no se capturen, la tarjeta de la
 * sucursal en /tienda simplemente no muestra la línea de COFEPRIS.
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
  await run('sucursales.responsable_sanitario',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS responsable_sanitario VARCHAR(150) NULL
       COMMENT 'Nombre del responsable sanitario/QFB de esta sucursal (COFEPRIS)' AFTER publicar_web`);
  await run('sucursales.cedula_responsable_sanitario',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS cedula_responsable_sanitario VARCHAR(30) NULL
       COMMENT 'Cédula profesional del responsable sanitario' AFTER responsable_sanitario`);
  await run('sucursales.licencia_sanitaria',
    `ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS licencia_sanitaria VARCHAR(50) NULL
       COMMENT 'Número de Aviso de Funcionamiento COFEPRIS de esta sucursal' AFTER cedula_responsable_sanitario`);

  console.log('\nMigración v57 terminada.');
  console.log('Captura los datos sanitarios (responsable, cédula, licencia) en Pos → Sucursales.');
  process.exit(0);
})();
