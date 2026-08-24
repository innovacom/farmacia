/**
 * Migración v63 — node migrate_v63.js
 * Contabilidad: 3 fases del plan de corrección del módulo (revisión 2026-08-24).
 *
 * FASE A — Saldos iniciales:
 *   polizas.verificada (TINYINT, def 1) distingue una apertura REAL/auditada de una
 *   provisional. La apertura de enero 2026 cargada en su momento (Fase 5, junio 2026)
 *   fue un dato FICTICIO usado para tener un punto de partida de prueba, no la balanza
 *   real del contador — esta migración la marca verificada=0 para que los reportes
 *   dejen de presentarla como si fuera oficial.
 *
 * FASE B — Complementos de pago (CFDI tipo P):
 *   cfdi_repositorio_pagos_doctos: detalle por documento relacionado (DoctoRelacionado)
 *   de cada complemento de pago, con el importe pagado y el IVA de esa parcialidad
 *   (cuando el XML lo trae en ImpuestosDR). Necesario para saldar cartera PPD y
 *   reclasificar IVA pendiente→cobrado/pagado.
 *
 * FASE C — Retenciones desglosadas:
 *   cfdi_repositorio_conceptos.importe_iva_ret (+ base/tasa) para capturar la
 *   retención de IVA (impuesto SAT '002'), que hasta ahora no se leía del XML
 *   (solo se leía ISR '001'). Sin esto no se puede separar ISR retenido de IVA
 *   retenido en las pólizas.
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
  // ── Fase A: apertura provisional vs. verificada ─────────────────────────────
  await run('polizas.verificada',
    "ALTER TABLE polizas ADD COLUMN IF NOT EXISTS verificada TINYINT NOT NULL DEFAULT 1 " +
    "COMMENT 'Apertura auditada con el contador (1) vs. provisional/de prueba (0); " +
    "solo relevante para origen=apertura, las autogeneradas desde CFDI nacen en 1'");

  const [[antes]] = await pool.query(
    "SELECT COUNT(*) n FROM polizas WHERE origen='apertura' AND verificada=1");
  await run('marcar apertura existente como PROVISIONAL (dato ficticio, no real)',
    "UPDATE polizas SET verificada=0 WHERE origen='apertura'");
  console.log(`INFO   pólizas de apertura marcadas como provisionales: ${antes.n}`);

  // ── Fase B: detalle de complementos de pago ─────────────────────────────────
  await run('cfdi_repositorio_pagos_doctos', `
    CREATE TABLE IF NOT EXISTS cfdi_repositorio_pagos_doctos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      pago_id BIGINT UNSIGNED NOT NULL COMMENT 'cfdi_repositorio.id del CFDI tipo P (encabezado del complemento)',
      uuid_documento CHAR(36) NOT NULL COMMENT 'UUID de la factura (I) que este pago liquida, total o parcialmente',
      moneda_dr VARCHAR(5) NULL,
      equivalencia_dr DECIMAL(18,6) NULL,
      num_parcialidad INT NULL,
      imp_saldo_ant DECIMAL(18,4) NULL,
      imp_pagado DECIMAL(18,4) NOT NULL DEFAULT 0,
      imp_saldo_insoluto DECIMAL(18,4) NULL,
      objeto_imp_dr VARCHAR(5) NULL,
      importe_iva_dr DECIMAL(18,4) NULL COMMENT 'IVA trasladado (002) de ImpuestosDR/TrasladosDR para esta parcialidad, cuando el XML lo trae',
      KEY ix_pago (pago_id),
      KEY ix_uuid_doc (uuid_documento),
      CONSTRAINT fk_pagodoc_pago FOREIGN KEY (pago_id)
        REFERENCES cfdi_repositorio(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Fase C: retención de IVA por concepto ───────────────────────────────────
  await run('cfdi_repositorio_conceptos.base_iva_ret',
    'ALTER TABLE cfdi_repositorio_conceptos ADD COLUMN IF NOT EXISTS base_iva_ret DECIMAL(18,4) NULL');
  await run('cfdi_repositorio_conceptos.tasa_iva_ret',
    'ALTER TABLE cfdi_repositorio_conceptos ADD COLUMN IF NOT EXISTS tasa_iva_ret DECIMAL(12,6) NULL');
  await run('cfdi_repositorio_conceptos.importe_iva_ret',
    'ALTER TABLE cfdi_repositorio_conceptos ADD COLUMN IF NOT EXISTS importe_iva_ret DECIMAL(18,4) NULL ' +
    "COMMENT 'Retención de IVA (impuesto SAT 002), separada de la retención de ISR (importe_isr)'");

  console.log('\nMigración v63 terminada.');
  process.exit(0);
})();
