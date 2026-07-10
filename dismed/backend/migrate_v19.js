/**
 * Migración v19 — node migrate_v19.js
 * Contabilidad: catálogo de cuentas (Código Agrupador del SAT, Anexo 24 RMF 2026)
 * y asignación de cuenta contable a entidades que participan en la contabilidad.
 *
 *  1) Tabla `sat_cuentas_agrupador` — catálogo oficial del SAT (se carga con
 *     scripts/cargar_sat_agrupador.js desde contabilidad_electronica_Sat.md).
 *  2) Columnas de cuenta contable (código agrupador) en:
 *       - proveedores: cuenta_pasivo_codigo (201 x def.) + cuenta_gasto_codigo
 *       - productos:   cuenta_ingreso_codigo (401) + cuenta_costo_codigo (501)
 *       - clientes:    cuenta_cobrar_codigo (105)
 *     Son VARCHAR(10) NULL (sin FK dura: el código es estándar SAT y la tabla
 *     catálogo puede recargarse; se valida en la capa de aplicación).
 *
 * Idempotente: CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS (MariaDB).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('sat_cuentas_agrupador (tabla)', `
    CREATE TABLE IF NOT EXISTS sat_cuentas_agrupador (
      codigo      VARCHAR(10)  NOT NULL,
      nivel       TINYINT      NOT NULL,
      naturaleza  CHAR(1)      NOT NULL COMMENT 'D=deudora, A=acreedora',
      padre       VARCHAR(10)  NULL     COMMENT 'código de la cuenta de mayor',
      rubro       VARCHAR(40)  NOT NULL COMMENT 'Activo, Pasivo, Capital, ...',
      nombre      VARCHAR(255) NOT NULL,
      PRIMARY KEY (codigo),
      KEY idx_rubro (rubro),
      KEY idx_padre (padre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Código agrupador de cuentas del SAT (Anexo 24 RMF)'
  `);

  // Cuenta contable en entidades. ADD COLUMN IF NOT EXISTS (MariaDB 10.2+).
  await run('proveedores.cuenta_pasivo_codigo',
    "ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cuenta_pasivo_codigo VARCHAR(10) NULL COMMENT 'Cuenta por pagar (agrupador SAT, def. 201)'");
  await run('proveedores.cuenta_gasto_codigo',
    "ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cuenta_gasto_codigo VARCHAR(10) NULL COMMENT 'Cuenta de gasto/costo/inventario (agrupador SAT)'");

  await run('productos.cuenta_ingreso_codigo',
    "ALTER TABLE productos ADD COLUMN IF NOT EXISTS cuenta_ingreso_codigo VARCHAR(10) NULL COMMENT 'Cuenta de ingreso por venta (agrupador SAT, def. 401)'");
  await run('productos.cuenta_costo_codigo',
    "ALTER TABLE productos ADD COLUMN IF NOT EXISTS cuenta_costo_codigo VARCHAR(10) NULL COMMENT 'Cuenta de costo de venta (agrupador SAT, def. 501)'");

  await run('clientes.cuenta_cobrar_codigo',
    "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cuenta_cobrar_codigo VARCHAR(10) NULL COMMENT 'Cuenta por cobrar (agrupador SAT, def. 105)'");

  console.log('\nMigración v19 terminada. Cargar catálogo: node scripts/cargar_sat_agrupador.js');
  process.exit(0);
})();
