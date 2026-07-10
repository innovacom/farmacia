/**
 * Migración v21 — node migrate_v21.js
 * Pólizas contables (asientos de partida doble) DERIVADAS del repositorio de CFDI
 * y de las salidas de inventario. Modelo ENCABEZADO–DETALLE, regenerable por periodo.
 *
 *   polizas             (encabezado: 1 asiento; tipo ingreso/egreso/diario)
 *   polizas_movimientos (detalle: cargos y abonos por cuenta del agrupador SAT)
 *
 * Además: marca el banco predeterminado (el que se usa en todos los movimientos,
 * Santander) sobre la tabla bancos creada en v20.
 *
 * Las pólizas con origen 'cfdi'/'inventario' se REGENERAN por periodo (se borran y
 * se reconstruyen); las 'manual' se preservan. No hay timbrado ni XML de
 * contabilidad electrónica todavía: es un papel de trabajo.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS (MariaDB 10.11).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── Encabezado de póliza ────────────────────────────────────────────────────
  await run('polizas', `
    CREATE TABLE IF NOT EXISTS polizas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tipo ENUM('ingreso','egreso','diario') NOT NULL DEFAULT 'diario'
        COMMENT 'ingreso=entra dinero, egreso=sale dinero, diario=lo demás',
      fecha DATE NOT NULL,
      periodo_anio SMALLINT UNSIGNED NOT NULL,
      periodo_mes TINYINT UNSIGNED NOT NULL,
      concepto VARCHAR(255) NULL,
      origen ENUM('cfdi','inventario','manual') NOT NULL DEFAULT 'cfdi'
        COMMENT 'cfdi/inventario = autogenerada (regenerable); manual = capturada a mano',
      cfdi_id BIGINT UNSIGNED NULL COMMENT 'cfdi_repositorio.id que originó la póliza',
      cfdi_uuid CHAR(36) NULL COMMENT 'UUID del CFDI (contabilidad electrónica)',
      referencia VARCHAR(60) NULL,
      total_cargos DECIMAL(18,2) NOT NULL DEFAULT 0,
      total_abonos DECIMAL(18,2) NOT NULL DEFAULT 0,
      usuario_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY ix_periodo (periodo_anio, periodo_mes),
      KEY ix_origen (origen),
      KEY ix_fecha (fecha),
      KEY ix_cfdi (cfdi_id),
      KEY ix_uuid (cfdi_uuid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Detalle: movimientos (cargos/abonos) ────────────────────────────────────
  await run('polizas_movimientos', `
    CREATE TABLE IF NOT EXISTS polizas_movimientos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      poliza_id BIGINT UNSIGNED NOT NULL,
      cuenta_codigo VARCHAR(10) NOT NULL COMMENT 'Código agrupador SAT (sat_cuentas_agrupador)',
      cargo DECIMAL(18,2) NOT NULL DEFAULT 0,
      abono DECIMAL(18,2) NOT NULL DEFAULT 0,
      concepto VARCHAR(255) NULL,
      entidad_tipo ENUM('cliente','proveedor','banco') NULL,
      entidad_id INT UNSIGNED NULL,
      KEY ix_poliza (poliza_id),
      KEY ix_cuenta (cuenta_codigo),
      CONSTRAINT fk_polmov_poliza FOREIGN KEY (poliza_id)
        REFERENCES polizas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Banco predeterminado (movimientos): Santander ───────────────────────────
  await run('bancos.predeterminado',
    "ALTER TABLE bancos ADD COLUMN IF NOT EXISTS predeterminado TINYINT NOT NULL DEFAULT 0 " +
    "COMMENT 'Banco usado en las pólizas automáticas (solo uno debería estar en 1)'");

  // Marca el primer Santander como predeterminado y le fija la cuenta 102.01 si está vacía.
  await run('bancos.marcar Santander predeterminado', `
    UPDATE bancos
       SET predeterminado = 1,
           cuenta_contable_codigo = COALESCE(NULLIF(cuenta_contable_codigo,''), '102.01')
     WHERE (nombre_corto LIKE '%SANTANDER%' OR razon_social LIKE '%SANTANDER%')
     ORDER BY id LIMIT 1`);

  const [[d]] = await pool.query(
    "SELECT COUNT(*) n, MAX(predeterminado) pred FROM bancos WHERE predeterminado=1");
  console.log(`INFO bancos predeterminados: ${d.n}`);

  console.log('\nMigración v21 terminada.');
  process.exit(0);
})();
