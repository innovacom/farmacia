/**
 * Migración v7 — node migrate_v7.js
 * Enlace Cotización → Pedido → Órdenes de compra → Recepción → Entrega (remisión/factura).
 * Folios (auto vía sp_generar_folio): PED, OC, REC, REM, FAC.
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('pedidos_cliente', `
    CREATE TABLE IF NOT EXISTS pedidos_cliente (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio         VARCHAR(20)  NOT NULL,
      cotizacion_id INT UNSIGNED NOT NULL,
      cliente_id    INT UNSIGNED NOT NULL,
      estatus       ENUM('abierto','surtido_parcial','surtido','entregado','cerrado','cancelado') NOT NULL DEFAULT 'abierto',
      notas         TEXT NULL,
      usuario_id    INT UNSIGNED NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_ped_folio (folio),
      KEY idx_ped_cot (cotizacion_id), KEY idx_ped_cli (cliente_id),
      CONSTRAINT fk_pedc_cot FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_cliente(id) ON UPDATE CASCADE,
      CONSTRAINT fk_pedc_cli FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('pedidos_cliente_partidas', `
    CREATE TABLE IF NOT EXISTS pedidos_cliente_partidas (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      pedido_id            INT UNSIGNED NOT NULL,
      cotizacion_partida_id INT UNSIGNED NULL,
      producto_id          INT UNSIGNED NULL,
      sku_interno          VARCHAR(20) NULL,
      codigo_cliente       VARCHAR(80) NULL,
      descripcion          VARCHAR(800) NOT NULL,
      unidad_medida        VARCHAR(30) NOT NULL DEFAULT 'pza',
      cantidad_asignada    DECIMAL(10,2) NOT NULL DEFAULT 0,
      precio_unitario_venta DECIMAL(12,2) NOT NULL DEFAULT 0,
      iva_exento           TINYINT(1) NOT NULL DEFAULT 0,
      proveedor_id         INT UNSIGNED NULL,
      precio_compra        DECIMAL(12,2) NOT NULL DEFAULT 0,
      cantidad_recibida    DECIMAL(10,2) NOT NULL DEFAULT 0,
      cantidad_entregada   DECIMAL(10,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (id), KEY idx_pcp_pedido (pedido_id), KEY idx_pcp_prod (producto_id),
      CONSTRAINT fk_pcp_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_cliente(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('ordenes_compra', `
    CREATE TABLE IF NOT EXISTS ordenes_compra (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio        VARCHAR(20) NOT NULL,
      pedido_id    INT UNSIGNED NOT NULL,
      proveedor_id INT UNSIGNED NOT NULL,
      estatus      ENUM('abierta','parcial','recibida','cancelada') NOT NULL DEFAULT 'abierta',
      total        DECIMAL(12,2) NOT NULL DEFAULT 0,
      pdf_path     VARCHAR(255) NULL,
      notas        TEXT NULL,
      usuario_id   INT UNSIGNED NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_oc_folio (folio),
      KEY idx_oc_pedido (pedido_id), KEY idx_oc_prov (proveedor_id),
      CONSTRAINT fk_oc_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_cliente(id) ON UPDATE CASCADE,
      CONSTRAINT fk_oc_prov FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('ordenes_compra_partidas', `
    CREATE TABLE IF NOT EXISTS ordenes_compra_partidas (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      oc_id             INT UNSIGNED NOT NULL,
      pedido_partida_id INT UNSIGNED NOT NULL,
      producto_id       INT UNSIGNED NULL,
      sku_interno       VARCHAR(20) NULL,
      descripcion       VARCHAR(800) NOT NULL,
      unidad_medida     VARCHAR(30) NOT NULL DEFAULT 'pza',
      cantidad          DECIMAL(10,2) NOT NULL DEFAULT 0,
      precio_compra     DECIMAL(12,2) NOT NULL DEFAULT 0,
      cantidad_recibida DECIMAL(10,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (id), KEY idx_ocp_oc (oc_id),
      CONSTRAINT fk_ocp_oc FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('recepciones', `
    CREATE TABLE IF NOT EXISTS recepciones (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio      VARCHAR(20) NOT NULL,
      oc_id      INT UNSIGNED NOT NULL,
      almacen_id INT UNSIGNED NOT NULL,
      notas      TEXT NULL,
      usuario_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_rec_folio (folio), KEY idx_rec_oc (oc_id),
      CONSTRAINT fk_rec_oc FOREIGN KEY (oc_id) REFERENCES ordenes_compra(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('recepciones_partidas', `
    CREATE TABLE IF NOT EXISTS recepciones_partidas (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      recepcion_id  INT UNSIGNED NOT NULL,
      oc_partida_id INT UNSIGNED NOT NULL,
      producto_id   INT UNSIGNED NOT NULL,
      cantidad      DECIMAL(10,2) NOT NULL,
      numero_lote   VARCHAR(50) NULL,
      fecha_caducidad DATE NULL,
      ubicacion_id  INT UNSIGNED NULL,
      costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
      movimiento_id INT UNSIGNED NULL,
      PRIMARY KEY (id), KEY idx_recp_rec (recepcion_id),
      CONSTRAINT fk_recp_rec FOREIGN KEY (recepcion_id) REFERENCES recepciones(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('entregas', `
    CREATE TABLE IF NOT EXISTS entregas (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio      VARCHAR(20) NOT NULL,
      tipo       ENUM('remision','factura') NOT NULL DEFAULT 'remision',
      pedido_id  INT UNSIGNED NOT NULL,
      cliente_id INT UNSIGNED NOT NULL,
      subtotal   DECIMAL(12,2) NOT NULL DEFAULT 0,
      iva        DECIMAL(12,2) NOT NULL DEFAULT 0,
      total      DECIMAL(12,2) NOT NULL DEFAULT 0,
      pdf_path   VARCHAR(255) NULL,
      notas      TEXT NULL,
      usuario_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_ent_folio (folio), KEY idx_ent_pedido (pedido_id),
      CONSTRAINT fk_ent_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_cliente(id) ON UPDATE CASCADE,
      CONSTRAINT fk_ent_cli FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('entregas_partidas', `
    CREATE TABLE IF NOT EXISTS entregas_partidas (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entrega_id        INT UNSIGNED NOT NULL,
      pedido_partida_id INT UNSIGNED NOT NULL,
      producto_id       INT UNSIGNED NULL,
      sku_interno       VARCHAR(20) NULL,
      descripcion       VARCHAR(800) NOT NULL,
      unidad_medida     VARCHAR(30) NOT NULL DEFAULT 'pza',
      cantidad          DECIMAL(10,2) NOT NULL,
      precio_unitario   DECIMAL(12,2) NOT NULL DEFAULT 0,
      iva_exento        TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (id), KEY idx_entp_ent (entrega_id),
      CONSTRAINT fk_entp_ent FOREIGN KEY (entrega_id) REFERENCES entregas(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  console.log('\nMigración v7 terminada.');
  process.exit(0);
})();
