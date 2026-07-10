/**
 * Migración v12 — node migrate_v12.js
 * Timbrado CFDI 4.0 con el PAC Facturama (API Web).
 *  - productos: claves SAT (ClaveProdServ y ClaveUnidad). Estas columnas las LEE
 *    cfdi.txt.generator.js y las ESCRIBE import.catalogo.js, pero ninguna migración
 *    previa las creaba (bloqueante #1 del timbrado).
 *  - cfdi_comprobantes: bitácora del comprobante timbrado/cancelado por entrega,
 *    con todos los datos del Timbre Fiscal Digital (UUID, sellos, certificados, etc.)
 *    y candado de doble timbrado vigente vía columna generada + UNIQUE.
 * Idempotente (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS — MariaDB 10.11).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── productos (claves SAT requeridas para el concepto CFDI) ──────────────────
  await run('productos.clave_sat', `
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS clave_sat VARCHAR(8) NULL
      COMMENT 'ClaveProdServ SAT (c_ClaveProdServ) — requerida CFDI'`);
  await run('productos.clave_unidad_sat', `
    ALTER TABLE productos
      ADD COLUMN IF NOT EXISTS clave_unidad_sat VARCHAR(3) NULL
      COMMENT 'ClaveUnidad SAT (c_ClaveUnidad), ej H87'`);

  // ── cfdi_comprobantes (bitácora del timbre) ─────────────────────────────────
  await run('cfdi_comprobantes', `
    CREATE TABLE IF NOT EXISTS cfdi_comprobantes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      entrega_id INT UNSIGNED NOT NULL,
      facturama_id VARCHAR(60) NOT NULL,
      uuid CHAR(36) NOT NULL,
      serie VARCHAR(25) NULL,
      folio VARCHAR(40) NULL,
      fecha_timbrado DATETIME NULL,
      sello_cfdi TEXT NULL,
      sello_sat TEXT NULL,
      cert_emisor VARCHAR(20) NULL,
      cert_sat VARCHAR(20) NULL,
      rfc_prov_certif VARCHAR(13) NULL,
      cadena_original_tfd TEXT NULL,
      cadena_original_comprobante MEDIUMTEXT NULL,
      qr_url TEXT NULL,
      xml_path VARCHAR(255) NULL,
      pdf_path VARCHAR(255) NULL,
      total DECIMAL(12,2) NULL,
      status ENUM('vigente','cancelado') NOT NULL DEFAULT 'vigente',
      motivo_cancelacion VARCHAR(2) NULL,
      uuid_sustituye CHAR(36) NULL,
      acuse_cancelacion MEDIUMTEXT NULL,
      raw_response MEDIUMTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      entrega_vigente INT UNSIGNED AS (CASE WHEN status = 'vigente' THEN entrega_id ELSE NULL END) STORED,
      UNIQUE KEY uq_entrega_vigente (entrega_vigente),
      KEY idx_entrega (entrega_id),
      KEY idx_uuid (uuid),
      CONSTRAINT fk_cfdi_entrega FOREIGN KEY (entrega_id) REFERENCES entregas (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v12 terminada.');
  process.exit(0);
})();
