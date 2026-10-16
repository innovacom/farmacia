/**
 * Migración v75 — node migrate_v75.js
 * cfdi_comprobantes.pac: PAC que timbró el comprobante ('facturama' | 'facturadigital').
 * La cancelación debe ir al PAC que lo emitió, aunque CFDI_PAC cambie después.
 * Los comprobantes existentes son de Facturama (default). Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

(async () => {
  try {
    await pool.query("ALTER TABLE cfdi_comprobantes ADD COLUMN pac VARCHAR(20) NOT NULL DEFAULT 'facturama' AFTER origen");
    console.log('OK  cfdi_comprobantes.pac');
  } catch (e) { console.log('INFO cfdi_comprobantes.pac — ' + e.message); }
  await pool.end();
})();
