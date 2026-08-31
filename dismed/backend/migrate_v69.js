/**
 * Migración v69 — node migrate_v69.js
 * Contabilidad · complementos de pago: periodo por FECHA DE PAGO + banderas de revisión.
 *
 * FASE A — Fecha de pago (nodo <Pago> del complemento):
 *   cfdi_repositorio_pagos: un renglón por nodo <Pago> de un CFDI tipo P, con
 *   FechaPago, Monto, FormaDePagoP, MonedaP, TipoCambioP, NumOperacion. Hasta ahora
 *   la única fecha de un complemento era Comprobante@Fecha (emisión), que el motor
 *   usaba para asignar el periodo contable; pero el cobro/pago real ocurre en
 *   FechaPago y suele caer un mes antes (el complemento se timbra a más tardar el
 *   día 5 del mes siguiente). El motor ahora periodiza y fecha la póliza por FechaPago.
 *   cfdi_repositorio_pagos_doctos.pago_detalle_id liga cada DoctoRelacionado con su
 *   <Pago> — un complemento puede traer varios pagos en fechas distintas y cada uno
 *   genera su propia póliza.
 *
 * FASE B — Retenciones e IEPS por parcialidad (poco común, baja prioridad):
 *   cfdi_repositorio_pagos_doctos.ret_isr_dr / ret_iva_dr / imp_ieps_dr — leídos de
 *   RetencionesDR y del IEPS de ImpuestosDR de cada DoctoRelacionado. En PPD la
 *   retención se causa AL PAGO, así que la factura PPD ya no la registra al emitirse
 *   (ver polizas.generator.js polizaVenta/polizaCompra) y el complemento la asienta.
 *
 * FASE C — Banderas de revisión de pólizas:
 *   polizas.revisar (TINYINT, def 0) + polizas.revisar_motivo. El motor marca una
 *   póliza cuando la registra "a ciegas" (complemento cuya factura relacionada no
 *   está en el repositorio, complemento sin FechaPago desglosada por ser anterior a
 *   esta migración, etc.): la póliza se genera igual pero queda señalada para que el
 *   contador la verifique. Se limpia sola al editar la póliza a mano.
 *
 * Idempotente: ADD COLUMN / CREATE TABLE IF NOT EXISTS (MariaDB 10.11).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── Fase C: banderas de revisión ───────────────────────────────────────────
  await run('polizas.revisar',
    "ALTER TABLE polizas ADD COLUMN IF NOT EXISTS revisar TINYINT NOT NULL DEFAULT 0 " +
    "COMMENT 'Póliza autogenerada que requiere verificación manual (posteo a ciegas / dato incompleto)'");
  await run('polizas.revisar_motivo',
    'ALTER TABLE polizas ADD COLUMN IF NOT EXISTS revisar_motivo VARCHAR(255) NULL');

  // ── Fase A: nodo <Pago> del complemento ────────────────────────────────────
  await run('cfdi_repositorio_pagos', `
    CREATE TABLE IF NOT EXISTS cfdi_repositorio_pagos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      pago_id BIGINT UNSIGNED NOT NULL COMMENT 'cfdi_repositorio.id del CFDI tipo P (encabezado del complemento)',
      linea INT NOT NULL DEFAULT 1 COMMENT 'Índice del nodo <Pago> dentro del complemento (1..n)',
      fecha_pago DATETIME NULL COMMENT 'Pago@FechaPago — fecha real del cobro/pago; periodiza la póliza',
      forma_pago VARCHAR(5) NULL COMMENT 'Pago@FormaDePagoP (catálogo c_FormaPago)',
      moneda VARCHAR(5) NULL,
      tipo_cambio DECIMAL(18,6) NULL,
      monto DECIMAL(18,4) NOT NULL DEFAULT 0,
      num_operacion VARCHAR(100) NULL,
      KEY ix_pago (pago_id),
      KEY ix_fecha_pago (fecha_pago),
      CONSTRAINT fk_pagos_pago FOREIGN KEY (pago_id)
        REFERENCES cfdi_repositorio(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('cfdi_repositorio_pagos_doctos.pago_detalle_id',
    "ALTER TABLE cfdi_repositorio_pagos_doctos ADD COLUMN IF NOT EXISTS pago_detalle_id BIGINT UNSIGNED NULL " +
    "COMMENT 'cfdi_repositorio_pagos.id del nodo <Pago> al que pertenece este DoctoRelacionado'");
  await run('cfdi_repositorio_pagos_doctos.ix_pago_detalle',
    'ALTER TABLE cfdi_repositorio_pagos_doctos ADD KEY ix_pago_detalle (pago_detalle_id)');

  // ── Fase B: retenciones / IEPS por DoctoRelacionado ────────────────────────
  await run('cfdi_repositorio_pagos_doctos.ret_isr_dr',
    "ALTER TABLE cfdi_repositorio_pagos_doctos ADD COLUMN IF NOT EXISTS ret_isr_dr DECIMAL(18,4) NULL " +
    "COMMENT 'ISR retenido (001) de RetencionesDR de esta parcialidad'");
  await run('cfdi_repositorio_pagos_doctos.ret_iva_dr',
    "ALTER TABLE cfdi_repositorio_pagos_doctos ADD COLUMN IF NOT EXISTS ret_iva_dr DECIMAL(18,4) NULL " +
    "COMMENT 'IVA retenido (002) de RetencionesDR de esta parcialidad'");
  await run('cfdi_repositorio_pagos_doctos.imp_ieps_dr',
    "ALTER TABLE cfdi_repositorio_pagos_doctos ADD COLUMN IF NOT EXISTS imp_ieps_dr DECIMAL(18,4) NULL " +
    "COMMENT 'IEPS trasladado (003) de ImpuestosDR de esta parcialidad (informativo)'");

  console.log('\nMigración v69 terminada.');
  process.exit(0);
})();
