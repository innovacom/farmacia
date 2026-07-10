/**
 * Migración v11 — node migrate_v11.js
 * Facturación CFDI 4.0 (hasta el TXT, sin timbrado).
 *  - clientes: código postal del domicilio fiscal (obligatorio CFDI 4.0) + email.
 *  - entregas: datos del comprobante (forma/método de pago, moneda) + ruta del TXT y estatus CFDI.
 * Idempotente (ADD COLUMN IF NOT EXISTS — soportado por MariaDB 10.x).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── clientes (receptor CFDI) ────────────────────────────────────────────────
  await run('clientes.codigo_postal', `
    ALTER TABLE clientes
      ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(5) NULL
      COMMENT 'DomicilioFiscalReceptor (CP) — obligatorio CFDI 4.0' AFTER uso_cfdi`);
  await run('clientes.email', `
    ALTER TABLE clientes
      ADD COLUMN IF NOT EXISTS email VARCHAR(150) NULL
      COMMENT 'Correo para envío de CFDI' AFTER codigo_postal`);

  // ── entregas (comprobante CFDI) ─────────────────────────────────────────────
  await run('entregas.forma_pago', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(2) NULL
      COMMENT 'Clave SAT c_FormaPago, ej: 01 efectivo, 03 transferencia, 99 por definir' AFTER total`);
  await run('entregas.metodo_pago', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(3) NULL
      COMMENT 'PUE (una exhibición) o PPD (parcialidades/diferido)' AFTER forma_pago`);
  await run('entregas.moneda', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'MXN' AFTER metodo_pago`);
  await run('entregas.uso_cfdi', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS uso_cfdi VARCHAR(10) NULL
      COMMENT 'Snapshot del UsoCFDI elegido para esta factura' AFTER moneda`);
  await run('entregas.cfdi_txt_path', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS cfdi_txt_path VARCHAR(255) NULL
      COMMENT 'Ruta del TXT generado para timbrado' AFTER uso_cfdi`);
  await run('entregas.estatus_cfdi', `
    ALTER TABLE entregas
      ADD COLUMN IF NOT EXISTS estatus_cfdi
      ENUM('pendiente','generado','timbrado','cancelado') NOT NULL DEFAULT 'pendiente' AFTER cfdi_txt_path`);

  console.log('\nMigración v11 terminada.');
  process.exit(0);
})();
