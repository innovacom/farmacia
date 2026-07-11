/**
 * Migración v28 — node migrate_v28.js
 * Fundación del módulo POS Farmacia (ver PROPUESTA_POS_FARMACIA.md, decisiones 2026-07-10):
 * multi-tenant (empresas + branding + config clave-valor por empresa), sucursales 1:1 con
 * almacenes, cajas y turnos con arqueo, catálogo de médicos, recetas, ventas de mostrador
 * y facturas globales. Alters mínimos a tablas existentes:
 *   - usuarios.empresa_id (backfill a empresa 1 = DISMED)
 *   - productos.clasificacion_cofepris (mapeo LGS Art. 226)
 *   - cfdi_comprobantes: entrega_id pasa a NULL + origen/pos_venta_id/pos_factura_global_id
 *     (las filas existentes quedan con origen='entrega'; el 1:1 actual no se rompe,
 *     solo deja de ser el único origen posible).
 *
 * Nota `pos_turnos.abierto_unico`: columna generada + UNIQUE (caja_id, abierto_unico)
 * garantiza máximo un turno abierto por caja (los NULL no colisionan). Requiere
 * MySQL >= 5.7 / MariaDB >= 10.2; si la instalación destino no la soporta, run() lo
 * degrada a INFO y queda vigente el candado transaccional (SELECT ... FOR UPDATE en
 * pos.turnos.service.js#abrir).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS y ALTERs envueltos en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── 1. Empresas (tenants) + branding ────────────────────────────────
  await run('CREATE empresas', `
    CREATE TABLE IF NOT EXISTS empresas (
      id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre           VARCHAR(200) NOT NULL,
      nombre_comercial VARCHAR(200) NULL,
      rfc              VARCHAR(13)  NULL,
      regimen_fiscal   VARCHAR(3)   NULL COMMENT 'c_RegimenFiscal (emisor CFDI por-tenant, Fase 3)',
      codigo_postal    VARCHAR(5)   NULL COMMENT 'LugarExpedicion futuro por-tenant',
      logo_path        VARCHAR(255) NULL COMMENT 'ruta relativa en /uploads/branding/',
      logo_ticket_path VARCHAR(255) NULL COMMENT 'version B/N para impresora termica (opcional)',
      color_primario   CHAR(7)      NOT NULL DEFAULT '#1a6bb5',
      color_secundario CHAR(7)      NULL,
      tema             ENUM('claro','oscuro') NOT NULL DEFAULT 'claro',
      activo           TINYINT(1)   NOT NULL DEFAULT 1,
      created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE empresas_config', `
    CREATE TABLE IF NOT EXISTS empresas_config (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id INT UNSIGNED NOT NULL,
      clave      VARCHAR(50)  NOT NULL,
      valor      TEXT         NULL,
      descripcion VARCHAR(200) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_empresa_clave (empresa_id, clave),
      CONSTRAINT fk_empcfg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── 2. Sucursales (1:1 con almacenes) y cajas ───────────────────────
  await run('CREATE sucursales', `
    CREATE TABLE IF NOT EXISTS sucursales (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id INT UNSIGNED NOT NULL,
      almacen_id INT UNSIGNED NOT NULL,
      codigo     VARCHAR(20)  NOT NULL,
      nombre     VARCHAR(150) NOT NULL,
      direccion  VARCHAR(300) NULL,
      telefono   VARCHAR(30)  NULL,
      responsable_usuario_id INT UNSIGNED NULL,
      activo     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sucursal_almacen (almacen_id),
      UNIQUE KEY uq_sucursal_codigo (empresa_id, codigo),
      CONSTRAINT fk_suc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_suc_almacen FOREIGN KEY (almacen_id) REFERENCES almacenes(id),
      CONSTRAINT fk_suc_resp    FOREIGN KEY (responsable_usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_cajas', `
    CREATE TABLE IF NOT EXISTS pos_cajas (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id  INT UNSIGNED NOT NULL,
      sucursal_id INT UNSIGNED NOT NULL,
      nombre      VARCHAR(80)  NOT NULL,
      activo      TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_caja (sucursal_id, nombre),
      CONSTRAINT fk_caja_empresa  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_caja_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── 3. Turnos y movimientos de caja ─────────────────────────────────
  await run('CREATE pos_turnos', `
    CREATE TABLE IF NOT EXISTS pos_turnos (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id    INT UNSIGNED NOT NULL,
      caja_id       INT UNSIGNED NOT NULL,
      usuario_id    INT UNSIGNED NOT NULL COMMENT 'cajero que abre',
      fondo_inicial DECIMAL(12,2) NOT NULL DEFAULT 0,
      estatus       ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto',
      abierto_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cerrado_en    DATETIME NULL,
      cerrado_por   INT UNSIGNED NULL,
      efectivo_esperado DECIMAL(12,2) NULL COMMENT 'fondo + ventas efectivo - cambio + depositos - retiros',
      efectivo_contado  DECIMAL(12,2) NULL,
      tarjeta_total     DECIMAL(12,2) NULL,
      diferencia        DECIMAL(12,2) NULL COMMENT 'contado - esperado; se registra, nunca se ajusta',
      notas_cierre  TEXT NULL,
      abierto_unico TINYINT AS (IF(estatus = 'abierto', 1, NULL)) STORED,
      PRIMARY KEY (id),
      UNIQUE KEY uq_turno_abierto (caja_id, abierto_unico),
      CONSTRAINT fk_turno_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_turno_caja    FOREIGN KEY (caja_id) REFERENCES pos_cajas(id),
      CONSTRAINT fk_turno_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_caja_movimientos', `
    CREATE TABLE IF NOT EXISTS pos_caja_movimientos (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id INT UNSIGNED NOT NULL,
      turno_id   INT UNSIGNED NOT NULL,
      tipo       ENUM('retiro','deposito') NOT NULL,
      monto      DECIMAL(12,2) NOT NULL,
      motivo     VARCHAR(200) NULL,
      usuario_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cajamov_turno (turno_id),
      CONSTRAINT fk_cajamov_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_cajamov_turno   FOREIGN KEY (turno_id) REFERENCES pos_turnos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── 4. Médicos y recetas (COFEPRIS) ─────────────────────────────────
  await run('CREATE medicos', `
    CREATE TABLE IF NOT EXISTS medicos (
      id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id          INT UNSIGNED NOT NULL,
      nombre              VARCHAR(150) NOT NULL,
      cedula_profesional  VARCHAR(20)  NOT NULL,
      especialidad        VARCHAR(100) NULL,
      institucion         VARCHAR(150) NULL COMMENT 'emisora de la cedula',
      telefono            VARCHAR(30)  NULL,
      activo              TINYINT(1)   NOT NULL DEFAULT 1,
      created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_medico_cedula (empresa_id, cedula_profesional),
      CONSTRAINT fk_medico_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_recetas', `
    CREATE TABLE IF NOT EXISTS pos_recetas (
      id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id         INT UNSIGNED NOT NULL,
      venta_id           INT UNSIGNED NULL COMMENT 'se liga al confirmar la venta',
      folio_receta       VARCHAR(50)  NULL,
      medico_id          INT UNSIGNED NOT NULL,
      paciente_nombre    VARCHAR(150) NOT NULL,
      paciente_domicilio VARCHAR(255) NULL COMMENT 'exigido en libro de control fracciones II/III',
      fecha_receta       DATE NOT NULL,
      retenida           TINYINT(1) NOT NULL DEFAULT 0,
      surtimiento        TINYINT NOT NULL DEFAULT 1 COMMENT 'fraccion III admite hasta 3',
      usuario_id         INT UNSIGNED NOT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_receta_venta (venta_id),
      CONSTRAINT fk_receta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_receta_medico  FOREIGN KEY (medico_id) REFERENCES medicos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── 5. Ventas de mostrador ──────────────────────────────────────────
  await run('CREATE pos_ventas', `
    CREATE TABLE IF NOT EXISTS pos_ventas (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id   INT UNSIGNED NOT NULL,
      sucursal_id  INT UNSIGNED NOT NULL,
      caja_id      INT UNSIGNED NOT NULL,
      turno_id     INT UNSIGNED NOT NULL,
      folio        VARCHAR(20)  NOT NULL,
      client_uuid  CHAR(36)     NULL COMMENT 'idempotencia de reintentos desde el POS',
      cliente_id   INT UNSIGNED NULL COMMENT 'NULL = publico en general',
      subtotal     DECIMAL(12,2) NOT NULL,
      descuento    DECIMAL(12,2) NOT NULL DEFAULT 0,
      iva          DECIMAL(12,2) NOT NULL DEFAULT 0,
      total        DECIMAL(12,2) NOT NULL,
      pago_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0,
      pago_tarjeta  DECIMAL(12,2) NOT NULL DEFAULT 0,
      cambio        DECIMAL(12,2) NOT NULL DEFAULT 0,
      estatus       ENUM('completada','cancelada') NOT NULL DEFAULT 'completada',
      cancelada_en  DATETIME NULL,
      cancelada_por INT UNSIGNED NULL,
      motivo_cancelacion VARCHAR(200) NULL,
      factura_estado ENUM('sin_factura','individual','global') NOT NULL DEFAULT 'sin_factura',
      cfdi_id            INT NULL COMMENT 'factura individual -> cfdi_comprobantes.id',
      factura_global_id  INT UNSIGNED NULL COMMENT '-> pos_facturas_globales.id',
      receptor_rfc     VARCHAR(13)  NULL COMMENT 'snapshot si pidio factura individual',
      receptor_razon   VARCHAR(255) NULL,
      receptor_cp      VARCHAR(5)   NULL,
      receptor_regimen VARCHAR(3)   NULL,
      receptor_uso     VARCHAR(4)   NULL,
      usuario_id   INT UNSIGNED NOT NULL COMMENT 'cajero',
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_venta_folio (folio),
      UNIQUE KEY uq_venta_client_uuid (client_uuid),
      KEY idx_venta_turno (turno_id),
      KEY idx_venta_fact (empresa_id, factura_estado, created_at),
      CONSTRAINT fk_venta_empresa  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_venta_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
      CONSTRAINT fk_venta_caja     FOREIGN KEY (caja_id) REFERENCES pos_cajas(id),
      CONSTRAINT fk_venta_turno    FOREIGN KEY (turno_id) REFERENCES pos_turnos(id),
      CONSTRAINT fk_venta_cliente  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_ventas_partidas', `
    CREATE TABLE IF NOT EXISTS pos_ventas_partidas (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id   INT UNSIGNED NOT NULL,
      venta_id     INT UNSIGNED NOT NULL,
      producto_id  INT UNSIGNED NOT NULL,
      descripcion  VARCHAR(300) NOT NULL COMMENT 'snapshot',
      cantidad     DECIMAL(12,3) NOT NULL,
      precio_unitario DECIMAL(12,4) NOT NULL COMMENT 'snapshot de precio_publico',
      descuento    DECIMAL(12,2) NOT NULL DEFAULT 0,
      iva_tasa     DECIMAL(5,4)  NOT NULL DEFAULT 0.1600,
      importe      DECIMAL(12,2) NOT NULL,
      clasificacion_cofepris VARCHAR(20) NOT NULL DEFAULT 'libre' COMMENT 'snapshot del producto',
      receta_id    INT UNSIGNED NULL,
      lotes_json   JSON NULL COMMENT '[{lote_id, lote, caducidad, cantidad}] del FEFO -> bitacora',
      PRIMARY KEY (id),
      KEY idx_partida_venta (venta_id),
      CONSTRAINT fk_partida_venta    FOREIGN KEY (venta_id) REFERENCES pos_ventas(id),
      CONSTRAINT fk_partida_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
      CONSTRAINT fk_partida_receta   FOREIGN KEY (receta_id) REFERENCES pos_recetas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE pos_facturas_globales', `
    CREATE TABLE IF NOT EXISTS pos_facturas_globales (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id   INT UNSIGNED NOT NULL,
      sucursal_id  INT UNSIGNED NULL COMMENT 'NULL = todas las sucursales',
      periodicidad ENUM('01','02','03','04','05') NOT NULL COMMENT 'c_Periodicidad SAT',
      meses        VARCHAR(2) NOT NULL COMMENT 'c_Meses',
      anio         SMALLINT   NOT NULL,
      desde        DATETIME   NOT NULL,
      hasta        DATETIME   NOT NULL,
      num_tickets  INT        NOT NULL DEFAULT 0,
      total        DECIMAL(12,2) NOT NULL DEFAULT 0,
      estatus      ENUM('borrador','timbrada','error','cancelada') NOT NULL DEFAULT 'borrador',
      cfdi_id      INT NULL COMMENT '-> cfdi_comprobantes.id',
      error_msg    TEXT NULL,
      creado_por   INT UNSIGNED NOT NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT fk_fglobal_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // FK cruzada venta -> factura global (después de crear ambas tablas)
  await run('FK pos_ventas.factura_global_id', `
    ALTER TABLE pos_ventas
      ADD CONSTRAINT fk_venta_fglobal FOREIGN KEY (factura_global_id)
      REFERENCES pos_facturas_globales(id)`);
  await run('FK pos_recetas.venta_id', `
    ALTER TABLE pos_recetas
      ADD CONSTRAINT fk_receta_venta FOREIGN KEY (venta_id) REFERENCES pos_ventas(id)`);

  // ── 6. Alters a tablas existentes ───────────────────────────────────
  await run('usuarios +empresa_id',
    `ALTER TABLE usuarios ADD COLUMN empresa_id INT UNSIGNED NULL`);
  await run('FK usuarios.empresa_id',
    `ALTER TABLE usuarios ADD CONSTRAINT fk_usuario_empresa
       FOREIGN KEY (empresa_id) REFERENCES empresas(id)`);

  await run('productos +clasificacion_cofepris', `
    ALTER TABLE productos ADD COLUMN clasificacion_cofepris
      ENUM('libre','venta_farmacia','antibiotico','fraccion_i','fraccion_ii','fraccion_iii')
      NOT NULL DEFAULT 'libre'
      COMMENT 'LGS Art. 226: I-III controlados, antibiotico = IV con retencion de receta'`);

  await run('cfdi_comprobantes.entrega_id -> NULL',
    `ALTER TABLE cfdi_comprobantes MODIFY COLUMN entrega_id INT UNSIGNED NULL`);
  await run('cfdi_comprobantes +origen', `
    ALTER TABLE cfdi_comprobantes
      ADD COLUMN origen ENUM('entrega','pos_venta','pos_global') NOT NULL DEFAULT 'entrega'`);
  await run('cfdi_comprobantes +pos_venta_id',
    `ALTER TABLE cfdi_comprobantes ADD COLUMN pos_venta_id INT UNSIGNED NULL`);
  await run('cfdi_comprobantes +pos_factura_global_id',
    `ALTER TABLE cfdi_comprobantes ADD COLUMN pos_factura_global_id INT UNSIGNED NULL`);

  // ── 7. Seeds ────────────────────────────────────────────────────────
  await run('seed empresa 1 (DISMED)', `
    INSERT IGNORE INTO empresas (id, nombre, nombre_comercial, rfc, regimen_fiscal, codigo_postal)
    VALUES (1, ?, ?, ?, ?, ?)`,
    [
      process.env.EMPRESA_NOMBRE || 'DISMED',
      process.env.EMPRESA_NOMBRE || 'DISMED',
      process.env.EMPRESA_RFC || null,
      process.env.EMPRESA_REGIMEN_FISCAL || null,
      process.env.EMPRESA_CP || null,
    ]);
  await run('backfill usuarios.empresa_id = 1',
    `UPDATE usuarios SET empresa_id = 1 WHERE empresa_id IS NULL`);

  console.log('\nMigración v28 terminada.');
  process.exit(0);
})();
