/**
 * Migración v13 — node migrate_v13.js
 * Repositorio fiscal de CFDI descargados del SAT (Descarga Masiva de Terceros)
 * + importación histórica del sistema anterior. Modelo ENCABEZADO–DETALLE.
 *
 *   cfdi_repositorio            (encabezado: 1 fila por UUID, emitido o recibido)
 *   cfdi_repositorio_conceptos  (detalle: renglones del comprobante)
 *   cfdi_descargas              (bitácora de cada ejecución de descarga masiva)
 *
 * NOTA: distinto de la tabla `cfdi_comprobantes` (migrate_v12), que es la bitácora
 * de TIMBRADO de nuestras facturas vía Facturama. Aquí guardamos el repositorio
 * fiscal completo (emitidos y recibidos) tal como lo entrega el SAT.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS (MariaDB 10.11).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── Encabezado ──────────────────────────────────────────────────────────────
  await run('cfdi_repositorio', `
    CREATE TABLE IF NOT EXISTS cfdi_repositorio (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid CHAR(36) NOT NULL COMMENT 'Folio fiscal (TimbreFiscalDigital/UUID)',
      tipo ENUM('emitido','recibido') NOT NULL
        COMMENT 'emitido = nuestro RFC es emisor; recibido = somos receptor',
      tipo_comprobante CHAR(1) NOT NULL DEFAULT 'I'
        COMMENT 'I=Ingreso E=Egreso T=Traslado N=Nómina P=Pago',
      version VARCHAR(5) NOT NULL DEFAULT '4.0',
      serie VARCHAR(25) NULL,
      folio VARCHAR(40) NULL,
      fecha DATETIME NULL COMMENT 'Comprobante@Fecha (emisión)',
      fecha_timbrado DATETIME NULL,
      rfc_emisor VARCHAR(13) NOT NULL,
      nombre_emisor VARCHAR(254) NULL,
      regimen_fiscal_emisor VARCHAR(5) NULL,
      rfc_receptor VARCHAR(13) NOT NULL,
      nombre_receptor VARCHAR(254) NULL,
      uso_cfdi VARCHAR(5) NULL,
      domicilio_fiscal_receptor VARCHAR(5) NULL,
      regimen_fiscal_receptor VARCHAR(5) NULL,
      lugar_expedicion VARCHAR(10) NULL,
      metodo_pago VARCHAR(5) NULL,
      forma_pago VARCHAR(5) NULL,
      condiciones_pago VARCHAR(100) NULL,
      moneda VARCHAR(5) NULL DEFAULT 'MXN',
      tipo_cambio DECIMAL(18,6) NULL,
      subtotal DECIMAL(18,4) NOT NULL DEFAULT 0,
      descuento DECIMAL(18,4) NOT NULL DEFAULT 0,
      total DECIMAL(18,4) NOT NULL DEFAULT 0,
      total_impuestos_trasladados DECIMAL(18,4) NULL,
      total_impuestos_retenidos DECIMAL(18,4) NULL,
      tipo_relacion VARCHAR(5) NULL,
      cfdi_relacionados TEXT NULL,
      no_certificado VARCHAR(20) NULL,
      no_certificado_sat VARCHAR(20) NULL,
      pac_rfc VARCHAR(13) NULL,
      estatus ENUM('vigente','cancelado','desconocido') NOT NULL DEFAULT 'vigente',
      origen ENUM('sat','legacy','sistema') NOT NULL DEFAULT 'sat'
        COMMENT 'sat=descarga masiva, legacy=sistema anterior, sistema=emitido por DISMED',
      xml_path VARCHAR(255) NULL COMMENT 'Ruta relativa del XML almacenado',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_uuid (uuid),
      KEY ix_tipo (tipo),
      KEY ix_fecha (fecha),
      KEY ix_emisor (rfc_emisor),
      KEY ix_receptor (rfc_receptor),
      KEY ix_tipo_comp (tipo_comprobante),
      KEY ix_estatus (estatus)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Detalle (conceptos) ─────────────────────────────────────────────────────
  await run('cfdi_repositorio_conceptos', `
    CREATE TABLE IF NOT EXISTS cfdi_repositorio_conceptos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      comprobante_id BIGINT UNSIGNED NOT NULL,
      linea INT NOT NULL DEFAULT 1,
      clave_prod_serv VARCHAR(10) NULL,
      no_identificacion VARCHAR(100) NULL,
      cantidad DECIMAL(18,6) NOT NULL DEFAULT 0,
      clave_unidad VARCHAR(10) NULL,
      unidad VARCHAR(50) NULL,
      descripcion VARCHAR(1000) NULL,
      valor_unitario DECIMAL(18,6) NOT NULL DEFAULT 0,
      importe DECIMAL(18,4) NOT NULL DEFAULT 0,
      descuento DECIMAL(18,4) NOT NULL DEFAULT 0,
      objeto_imp VARCHAR(5) NULL,
      base_iva DECIMAL(18,4) NULL, tasa_iva DECIMAL(12,6) NULL, importe_iva DECIMAL(18,4) NULL,
      base_ieps DECIMAL(18,4) NULL, tasa_ieps DECIMAL(12,6) NULL, importe_ieps DECIMAL(18,4) NULL,
      base_isr DECIMAL(18,4) NULL, tasa_isr DECIMAL(12,6) NULL, importe_isr DECIMAL(18,4) NULL,
      codigo_interno VARCHAR(30) NULL COMMENT 'Equivalencia interna (legacy codigo_innovacom)',
      KEY ix_comprobante (comprobante_id),
      KEY ix_clave_ps (clave_prod_serv),
      KEY ix_no_ident (no_identificacion),
      CONSTRAINT fk_cfdirepo_concepto FOREIGN KEY (comprobante_id)
        REFERENCES cfdi_repositorio(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Bitácora de descargas masivas ───────────────────────────────────────────
  await run('cfdi_descargas', `
    CREATE TABLE IF NOT EXISTS cfdi_descargas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tipo ENUM('emitido','recibido') NOT NULL,
      fecha_desde DATE NOT NULL,
      fecha_hasta DATE NOT NULL,
      sat_id_solicitud VARCHAR(60) NULL COMMENT 'IdSolicitud devuelto por el SAT',
      estado VARCHAR(30) NOT NULL DEFAULT 'solicitada'
        COMMENT 'solicitada|en_proceso|terminada|error|rechazada|vencida|descargada',
      estado_codigo VARCHAR(10) NULL COMMENT 'CodigoEstadoSolicitud del SAT (5000,5002,...)',
      num_cfdis INT NULL,
      num_paquetes INT NULL,
      num_importados INT NOT NULL DEFAULT 0,
      mensaje TEXT NULL,
      origen ENUM('manual','automatico') NOT NULL DEFAULT 'manual',
      usuario_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY ix_tipo (tipo),
      KEY ix_estado (estado),
      KEY ix_sat_id (sat_id_solicitud)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v13 terminada.');
  process.exit(0);
})();
