/**
 * Migración v26 — node migrate_v26.js
 * `solicitudes.controller.js` y `NuevaSolicitud.jsx` ya usan `atencion`, `concepto` y
 * `factor_ganancia` en `solicitudes`, y `cotcli.controller.js` ya usa `atencion` en
 * `cotizaciones_cliente` (a diferencia de `concepto`/`contacto_id`/`elaborado_por_id`, que sí
 * quedaron migrados en migrate_v2.js) — pero ninguna de estas columnas existe en
 * dismed_schema_v2.sql ni en migrate_v2..v25: drift no versionado (se agregaron a mano en
 * algún momento). Esta migración las deja declaradas para que el ambiente local (y cualquier
 * otro) quede igual que producción.
 *
 * Idempotente: ADD COLUMN envuelto en try-catch (columna ya existente -> INFO, no falla).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('solicitudes.atencion', `
    ALTER TABLE solicitudes
      ADD COLUMN atencion VARCHAR(150) NULL COMMENT 'Persona a quien se dirige la cotización'
      AFTER referencia_cliente`);

  await run('solicitudes.concepto', `
    ALTER TABLE solicitudes
      ADD COLUMN concepto VARCHAR(255) NULL
      AFTER atencion`);

  await run('solicitudes.factor_ganancia', `
    ALTER TABLE solicitudes
      ADD COLUMN factor_ganancia DECIMAL(6,4) NULL COMMENT 'Ej. 0.15 = 15%'
      AFTER concepto`);

  await run('cotizaciones_cliente.atencion', `
    ALTER TABLE cotizaciones_cliente
      ADD COLUMN atencion VARCHAR(150) NULL COMMENT 'Persona a quien se dirige la cotización'
      AFTER concepto`);

  console.log('\nMigración v26 terminada.');
  process.exit(0);
})();
