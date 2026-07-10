/**
 * Migración v25 — node migrate_v25.js
 * Ingesta de facturas/comprobantes de pago en PDF (n8n → DISMED).
 * Ver DISEÑO_INTEGRACION_FACTURAS_N8N.md.
 *
 *   cfdi_repositorio_conceptos (ALTER) — lote/caducidad extraídos por IA, para trazabilidad fiscal.
 *   pagos_comprobantes         (NUEVA) — solo se guardan y se relacionan con la factura pagada.
 *   ingestion_log              (NUEVA) — bitácora de cada PDF recibido (mismo patrón que cfdi_descargas).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS / ADD COLUMN envueltos en try-catch (MariaDB 10.11
 * no soporta ADD COLUMN IF NOT EXISTS de forma uniforme en todas las cláusulas usadas aquí).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cfdi_repositorio_conceptos.lote_extraido', `
    ALTER TABLE cfdi_repositorio_conceptos
      ADD COLUMN lote_extraido VARCHAR(50) NULL COMMENT 'Extraído del PDF vía IA, el XML no lo trae'`);

  await run('cfdi_repositorio_conceptos.fecha_caducidad_extraida', `
    ALTER TABLE cfdi_repositorio_conceptos
      ADD COLUMN fecha_caducidad_extraida DATE NULL`);

  await run('cfdi_repositorio_conceptos.producto_id', `
    ALTER TABLE cfdi_repositorio_conceptos
      ADD COLUMN producto_id INT UNSIGNED NULL COMMENT 'Match por código exacto (sku_proveedor/sku_interno/ean)'`);

  await run('cfdi_repositorio_conceptos.estado_lote', `
    ALTER TABLE cfdi_repositorio_conceptos
      ADD COLUMN estado_lote ENUM('pendiente','integrado','revision_manual','sin_control') NOT NULL DEFAULT 'pendiente'`);

  await run('fk_cfdirepoconcepto_producto', `
    ALTER TABLE cfdi_repositorio_conceptos
      ADD CONSTRAINT fk_cfdirepoconcepto_producto FOREIGN KEY (producto_id) REFERENCES productos(id)`);

  await run('pagos_comprobantes', `
    CREATE TABLE IF NOT EXISTS pagos_comprobantes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cfdi_repositorio_id BIGINT UNSIGNED NULL COMMENT 'Factura relacionada, si se identificó',
      monto DECIMAL(18,2) NULL,
      fecha_pago DATE NULL,
      forma_pago VARCHAR(50) NULL,
      referencia VARCHAR(100) NULL,
      archivo_nombre VARCHAR(255) NOT NULL,
      archivo_path VARCHAR(255) NOT NULL,
      estado ENUM('vinculado','sin_vincular') NOT NULL DEFAULT 'sin_vincular',
      origen ENUM('correo','carpeta') NOT NULL DEFAULT 'correo',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_pago_cfdi (cfdi_repositorio_id),
      KEY idx_pago_estado (estado),
      CONSTRAINT fk_pago_cfdi FOREIGN KEY (cfdi_repositorio_id) REFERENCES cfdi_repositorio(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('ingestion_log', `
    CREATE TABLE IF NOT EXISTS ingestion_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tipo ENUM('factura','pago') NOT NULL,
      origen ENUM('correo','carpeta') NOT NULL DEFAULT 'correo',
      archivo_nombre VARCHAR(255) NOT NULL,
      estado ENUM('procesado','revision_manual','error') NOT NULL,
      recepcion_id INT UNSIGNED NULL COMMENT 'Si generó una recepción automática',
      cfdi_uuid_detectado CHAR(36) NULL,
      proveedor_id INT UNSIGNED NULL,
      mensaje TEXT NULL,
      detalle_json JSON NULL COMMENT 'Encabezado + partidas extraídas, para revisión manual',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ing_tipo (tipo),
      KEY idx_ing_estado (estado),
      KEY idx_ing_proveedor (proveedor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  console.log('\nMigración v25 terminada.');
  process.exit(0);
})();
