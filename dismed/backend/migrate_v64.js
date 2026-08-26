/**
 * Migración v64 — node migrate_v64.js
 * Contabilidad: tercer nivel del catálogo de cuentas (cuentas auxiliares/de detalle).
 *
 * El agrupador SAT (sat_cuentas_agrupador) solo llega a 2 niveles: mayor (AAA,
 * acumulativo) y subcuenta (AAA.BB, acumulativo). Las pólizas necesitan un
 * tercer nivel donde de verdad "aterrizan" los movimientos — el auxiliar de
 * detalle, p.ej. 105.01.01 = un cliente específico dentro de "105.01 Clientes
 * nacionales". Sin este nivel, todos los clientes/proveedores compartían la
 * misma subcuenta y no se podía sacar un estado de cuenta por entidad.
 *
 * `cuentas_auxiliares`: catálogo de nivel 3. Cada fila cuelga de una subcuenta
 * (cuenta_padre, debe existir en sat_cuentas_agrupador con nivel=2) y tiene un
 * consecutivo correlativo dentro de esa subcuenta (01, 02, ...). Dos orígenes:
 *   - Automático: la primera vez que un cliente/proveedor genera un movimiento
 *     bajo una subcuenta, el motor de pólizas (polizas.generator.js vía
 *     cuentas.auxiliares.js) le asigna el siguiente consecutivo libre.
 *   - Manual: de alta libre desde el catálogo, para cualquier subcuenta
 *     (p.ej. un auxiliar de gasto que no corresponde a cliente/proveedor/banco).
 * Sin FK dura a sat_cuentas_agrupador (mismo criterio que clientes/proveedores/
 * productos en migrate_v19: el código se valida en la capa de aplicación, evita
 * problemas de collation entre tablas — ver nota de Fase 6 en la memoria del
 * proyecto).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cuentas_auxiliares (tabla)', `
    CREATE TABLE IF NOT EXISTS cuentas_auxiliares (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      cuenta_padre  VARCHAR(10)  NOT NULL COMMENT 'Subcuenta del agrupador SAT, nivel 2 (ej. 105.01)',
      consecutivo   INT UNSIGNED NOT NULL COMMENT 'Correlativo dentro de la subcuenta (1, 2, 3...)',
      codigo        VARCHAR(15)  NOT NULL COMMENT 'Código completo nivel 3 (cuenta_padre.consecutivo, ej. 105.01.01)',
      nombre        VARCHAR(150) NOT NULL,
      entidad_tipo  ENUM('cliente','proveedor','banco','manual') NOT NULL DEFAULT 'manual',
      entidad_id    INT UNSIGNED NULL COMMENT 'id en clientes/proveedores/bancos según entidad_tipo; NULL si manual',
      activo        TINYINT      NOT NULL DEFAULT 1,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_codigo (codigo),
      UNIQUE KEY uq_padre_consecutivo (cuenta_padre, consecutivo),
      UNIQUE KEY uq_entidad_padre (entidad_tipo, entidad_id, cuenta_padre),
      KEY ix_padre (cuenta_padre),
      KEY ix_entidad (entidad_tipo, entidad_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      COMMENT='Catálogo de cuentas auxiliares (nivel 3 de detalle, cuelga de sat_cuentas_agrupador nivel 2)'
  `);

  console.log('\nMigración v64 terminada.');
  process.exit(0);
})();
