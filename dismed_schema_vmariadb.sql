-- ============================================================
--  SISTEMA DE DISTRIBUCIÓN MÉDICA — ESQUEMA BD v2
--  Motor: MariaDB 10.6+ (probado en 12.1.2)
--  Generado: 2025-05-01  |  Revisado: 2025-05-02
--
--  ── CÓMO EJECUTAR EN phpMyAdmin ──────────────────────────────
--  1. Ir a: Importar → Seleccionar archivo → dismed_schema_v2.sql
--  2. Formato: SQL  |  Conjunto de caracteres: utf8mb4
--  3. NO usar el editor de consultas (no soporta DELIMITER)
--  ─────────────────────────────────────────────────────────────
-- ============================================================

-- Limpiar estado anterior (si existía una versión previa)
DROP DATABASE IF EXISTS dismed_db;

CREATE DATABASE dismed_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dismed_db;

-- Compatibilidad MariaDB: desactivar checks durante creación
SET FOREIGN_KEY_CHECKS  = 0;
SET SESSION sql_mode    = 'NO_ENGINE_SUBSTITUTION';

-- ============================================================
--  1. CLIENTES
-- ============================================================

use dismed_db;

CREATE TABLE clientes (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  razon_social     VARCHAR(200)     NOT NULL,
  nombre_comercial VARCHAR(200)     NULL,
  rfc              VARCHAR(13)      NOT NULL,
  regimen_fiscal   VARCHAR(100)     NULL     COMMENT 'Para CFDI 4.0',
  uso_cfdi         VARCHAR(10)      NULL     COMMENT 'Clave SAT, ej: G03',
  tipo_cliente     ENUM('hospital','clinica','farmacia','laboratorio','gobierno','otro')
                                    NOT NULL DEFAULT 'otro',
  limite_credito   DECIMAL(12,2)    NOT NULL DEFAULT 0.00,
  dias_credito     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  direccion_fiscal TEXT             NULL,
  activo           TINYINT(1)       NOT NULL DEFAULT 1,
  notas            TEXT             NULL,
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                             ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cliente_rfc   (rfc),
  KEY        idx_cliente_tipo (tipo_cliente),
  KEY        idx_cliente_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Clientes compradores de insumos médicos';


CREATE TABLE clientes_contactos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id   INT UNSIGNED NOT NULL,
  nombre       VARCHAR(150) NOT NULL,
  puesto       VARCHAR(100) NULL,
  email        VARCHAR(150) NULL,
  telefono     VARCHAR(20)  NULL,
  es_principal TINYINT(1)   NOT NULL DEFAULT 0
               COMMENT '1 = recibe cotizaciones automáticas',
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_cc_cliente (cliente_id),
  CONSTRAINT fk_cc_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Contactos por cliente';


-- ============================================================
--  2. PROVEEDORES
-- ============================================================

CREATE TABLE proveedores (
  id                 INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  nombre_empresa     VARCHAR(200)     NOT NULL,
  nombre_contacto    VARCHAR(150)     NULL COMMENT 'Persona de contacto principal',
  puesto_contacto    VARCHAR(100)     NULL,
  rfc                VARCHAR(13)      NULL,
  email_cotizaciones VARCHAR(150)     NULL,
  telefono           VARCHAR(20)      NULL,
  whatsapp           VARCHAR(20)      NULL,
  dias_entrega_prom  TINYINT UNSIGNED NOT NULL DEFAULT 3
                     COMMENT 'Promedio real, se actualiza con historial',
  notas              TEXT             NULL,
  activo             TINYINT(1)       NOT NULL DEFAULT 1,
  created_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prov_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Proveedores de insumos médicos';


CREATE TABLE proveedores_categorias (
  proveedor_id INT UNSIGNED NOT NULL,
  categoria    ENUM('medicamento','material_curacion','ropa_hospital',
                    'equipo_clinica','laboratorio','detergente','otro') NOT NULL,
  PRIMARY KEY (proveedor_id, categoria),
  CONSTRAINT fk_pc_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Categorías que maneja cada proveedor';


-- ============================================================
--  3. PRODUCTOS E INVENTARIO
-- ============================================================

CREATE TABLE productos (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku_interno       VARCHAR(20)   NOT NULL COMMENT 'Formato DM-00001, generado automáticamente',
  descripcion       VARCHAR(800)  NOT NULL,
  descripcion_corta VARCHAR(150)  NULL     COMMENT 'Para PDF de cotización',
  categoria         ENUM('medicamento','material_curacion','ropa_hospital',
                         'equipo_clinica','laboratorio','detergente','otro')
                                  NOT NULL DEFAULT 'otro',
  unidad_medida     VARCHAR(30)   NOT NULL DEFAULT 'pza',
  clave_sat         VARCHAR(10)   NULL     COMMENT 'Clave producto/servicio SAT',
  clave_unidad_sat  VARCHAR(6)    NULL     COMMENT 'Clave unidad SAT, ej: H87',
  stock_minimo      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  activo            TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sku_interno    (sku_interno),
  KEY        idx_prod_categoria (categoria),
  KEY        idx_prod_activo    (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo interno. sku_interno es el eje de todo el sistema.';


CREATE TABLE inventario_lotes (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  producto_id      INT UNSIGNED  NOT NULL,
  proveedor_id     INT UNSIGNED  NULL     COMMENT 'Proveedor del que se compró este lote',
  numero_lote      VARCHAR(50)   NULL,
  fecha_caducidad  DATE          NULL,
  cantidad_inicial DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  cantidad_actual  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  costo_unitario   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  fecha_entrada    DATE          NOT NULL,
  notas            VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  KEY idx_lote_producto   (producto_id),
  KEY idx_lote_caducidad  (fecha_caducidad),
  KEY idx_lote_proveedor  (proveedor_id),
  CONSTRAINT fk_lote_producto  FOREIGN KEY (producto_id)
    REFERENCES productos(id)   ON UPDATE CASCADE,
  CONSTRAINT fk_lote_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lotes de inventario con trazabilidad. FIFO en salidas.';


-- ============================================================
--  4. DICCIONARIOS DE EQUIVALENCIAS DE CÓDIGOS
-- ============================================================

CREATE TABLE clientes_skus (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id          INT UNSIGNED NOT NULL,
  sku_cliente         VARCHAR(80)  NOT NULL COMMENT 'Código exacto que usa el cliente',
  descripcion_cliente VARCHAR(800) NULL     COMMENT 'Descripción original del cliente',
  producto_id         INT UNSIGNED NULL     COMMENT 'Equivalencia con nuestro catálogo',
  confirmado          TINYINT(1)   NOT NULL DEFAULT 0
                      COMMENT '0=sugerencia automática, 1=confirmado por usuario',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cliente_sku   (cliente_id, sku_cliente),
  KEY        idx_csku_producto (producto_id),
  CONSTRAINT fk_csku_cliente  FOREIGN KEY (cliente_id)
    REFERENCES clientes(id)   ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_csku_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id)  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Diccionario: código del cliente → nuestro sku_interno';


CREATE TABLE proveedores_skus (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  proveedor_id          INT UNSIGNED  NOT NULL,
  sku_proveedor         VARCHAR(80)   NOT NULL COMMENT 'Código exacto del proveedor',
  descripcion_proveedor VARCHAR(800)  NULL,
  producto_id           INT UNSIGNED  NULL     COMMENT 'Equivalencia con nuestro catálogo',
  ultimo_precio         DECIMAL(12,2) NULL,
  ultima_cotizacion     DATE          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prov_sku      (proveedor_id, sku_proveedor),
  KEY        idx_psku_producto (producto_id),
  CONSTRAINT fk_psku_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_psku_producto  FOREIGN KEY (producto_id)
    REFERENCES productos(id)   ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Diccionario: código del proveedor → nuestro sku_interno';


-- ============================================================
--  5. SOLICITUDES DEL CLIENTE
-- ============================================================

CREATE TABLE solicitudes (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio              VARCHAR(20)  NOT NULL COMMENT 'SOL-2025-0001',
  cliente_id         INT UNSIGNED NOT NULL,
  contacto_id        INT UNSIGNED NULL DEFAULT NULL,
  referencia_cliente VARCHAR(100) NULL DEFAULT NULL COMMENT 'Requisición del cliente',
  archivo_origen     VARCHAR(255) NULL DEFAULT NULL COMMENT 'Nombre del archivo subido',
  tipo_origen        ENUM('excel','pdf','manual') NOT NULL DEFAULT 'manual',
  estatus            ENUM('nueva','cotizando','cotizada','pedido','cancelada')
                                 NOT NULL DEFAULT 'nueva',
  notas              TEXT         NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_solicitud_folio (folio),
  KEY        idx_sol_cliente    (cliente_id),
  KEY        idx_sol_contacto   (contacto_id),   -- requerido por MariaDB para FK nullable
  KEY        idx_sol_estatus    (estatus),
  CONSTRAINT fk_sol_cliente  FOREIGN KEY (cliente_id)
    REFERENCES clientes(id)           ON UPDATE CASCADE,
  CONSTRAINT fk_sol_contacto FOREIGN KEY (contacto_id)
    REFERENCES clientes_contactos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encabezado de solicitud de cotización recibida del cliente';


CREATE TABLE solicitudes_partidas (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  solicitud_id         INT UNSIGNED  NOT NULL,
  linea                SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Número de renglón',
  codigo_cliente       VARCHAR(80)   NULL DEFAULT NULL COMMENT 'Código tal como viene del cliente',
  descripcion_original VARCHAR(800)  NOT NULL COMMENT 'Texto exacto del cliente sin modificar',
  producto_id          INT UNSIGNED  NULL DEFAULT NULL COMMENT 'Resuelto automático o manual',
  cantidad             DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  unidad_medida        VARCHAR(30)   NOT NULL DEFAULT 'pza',
  observaciones        TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_sp_solicitud     (solicitud_id),
  KEY idx_sp_codigo_cliente (codigo_cliente),
  KEY idx_sp_producto      (producto_id),
  CONSTRAINT fk_sp_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sp_producto  FOREIGN KEY (producto_id)
    REFERENCES productos(id)   ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Partidas de la solicitud del cliente. codigo_cliente guardado tal cual.';


-- ============================================================
--  6. COTIZACIONES A PROVEEDORES Y COMPARADOR
-- ============================================================

CREATE TABLE cotizaciones_proveedor (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solicitud_id    INT UNSIGNED NOT NULL,
  proveedor_id    INT UNSIGNED NOT NULL,
  estatus         ENUM('solicitada','recibida','vencida') NOT NULL DEFAULT 'solicitada',
  fecha_solicitud TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- DATETIME NULL en vez de TIMESTAMP NULL (más seguro en MariaDB)
  fecha_respuesta DATETIME     NULL DEFAULT NULL,
  partidas_json   JSON         NULL COMMENT 'IDs de partidas incluidas; NULL = todas',
  notas           TEXT         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cot_prov_solicitud (solicitud_id, proveedor_id),
  KEY        idx_cp_proveedor      (proveedor_id),
  KEY        idx_cp_estatus        (estatus),
  CONSTRAINT fk_cp_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id)  ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cp_proveedor  FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id)  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Una fila por proveedor consultado en cada solicitud';


CREATE TABLE cotizaciones_proveedor_precios (
  id                      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cotizacion_proveedor_id INT UNSIGNED  NOT NULL,
  partida_id              INT UNSIGNED  NOT NULL,
  sku_proveedor           VARCHAR(80)   NULL DEFAULT NULL COMMENT 'Código del proveedor',
  descripcion_proveedor   VARCHAR(800)  NULL DEFAULT NULL,
  observaciones_proveedor VARCHAR(500)  NULL DEFAULT NULL COMMENT 'Marca, tiempo entrega, especificaciones',
  precio_unitario         DECIMAL(12,2) NULL DEFAULT NULL COMMENT 'NULL = no disponible',
  disponible              TINYINT(1)    NOT NULL DEFAULT 1,
  es_mejor_precio         TINYINT(1)    NOT NULL DEFAULT 0
                          COMMENT 'Calculado automáticamente al comparar',
  PRIMARY KEY (id),
  UNIQUE KEY uq_cpp_cot_partida (cotizacion_proveedor_id, partida_id),
  KEY        idx_cpp_partida    (partida_id),
  KEY        idx_cpp_sku_prov   (sku_proveedor),
  CONSTRAINT fk_cpp_cotizacion FOREIGN KEY (cotizacion_proveedor_id)
    REFERENCES cotizaciones_proveedor(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cpp_partida    FOREIGN KEY (partida_id)
    REFERENCES solicitudes_partidas(id)   ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Precio por proveedor × partida. Alimenta proveedores_skus automáticamente.';


-- ============================================================
--  7. COTIZACIONES AL CLIENTE
-- ============================================================

CREATE TABLE cotizaciones_cliente (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  folio          VARCHAR(20)      NOT NULL COMMENT 'COT-2025-0001',
  solicitud_id   INT UNSIGNED     NOT NULL,
  cliente_id     INT UNSIGNED     NOT NULL,
  subtotal       DECIMAL(12,2)    NOT NULL DEFAULT 0.00,
  iva            DECIMAL(12,2)    NOT NULL DEFAULT 0.00,
  total          DECIMAL(12,2)    NOT NULL DEFAULT 0.00,
  condicion_pago VARCHAR(50)      NULL     DEFAULT 'Contado',
  dias_credito   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  dias_vigencia  TINYINT UNSIGNED NOT NULL DEFAULT 10,
  tiempo_entrega VARCHAR(100)     NULL     DEFAULT '3 a 5 días hábiles',
  estatus        ENUM('borrador','enviada','aceptada','rechazada','vencida')
                                  NOT NULL DEFAULT 'borrador',
  pdf_path       VARCHAR(255)     NULL DEFAULT NULL,
  notas          TEXT             NULL,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cot_cli_folio (folio),
  KEY        idx_cc_cliente   (cliente_id),
  KEY        idx_cc_solicitud (solicitud_id),
  KEY        idx_cc_estatus   (estatus),
  CONSTRAINT fk_cotcli_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id) ON UPDATE CASCADE,
  CONSTRAINT fk_cotcli_cliente   FOREIGN KEY (cliente_id)
    REFERENCES clientes(id)    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encabezado de cotización enviada al cliente';


CREATE TABLE cotizaciones_cliente_partidas (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cotizacion_id         INT UNSIGNED  NOT NULL,
  partida_solicitud_id  INT UNSIGNED  NULL DEFAULT NULL COMMENT 'Referencia a solicitud original',
  producto_id           INT UNSIGNED  NULL DEFAULT NULL,
  sku_interno           VARCHAR(20)   NULL DEFAULT NULL COMMENT 'Copia de productos.sku_interno',
  codigo_cliente        VARCHAR(80)   NULL DEFAULT NULL COMMENT 'Código del cliente para el PDF',
  linea                 SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  descripcion           VARCHAR(800)  NOT NULL,
  cantidad              DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  unidad_medida         VARCHAR(30)   NOT NULL DEFAULT 'pza',
  precio_compra         DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Precio del mejor proveedor',
  margen_pct            DECIMAL(5,2)  NOT NULL DEFAULT 0.00 COMMENT '% de ganancia aplicado',
  precio_unitario_venta DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  importe               DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  observaciones         TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_ccp_cotizacion (cotizacion_id),
  KEY idx_ccp_partida    (partida_solicitud_id),  -- requerido por MariaDB para FK nullable
  KEY idx_ccp_producto   (producto_id),
  KEY idx_ccp_sku        (sku_interno),
  CONSTRAINT fk_ccp_cotizacion FOREIGN KEY (cotizacion_id)
    REFERENCES cotizaciones_cliente(id)  ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ccp_partida    FOREIGN KEY (partida_solicitud_id)
    REFERENCES solicitudes_partidas(id)  ON UPDATE CASCADE,
  CONSTRAINT fk_ccp_producto   FOREIGN KEY (producto_id)
    REFERENCES productos(id)             ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Partidas de cotización al cliente con sku_interno y código del cliente';


-- ============================================================
--  8. PEDIDOS
-- ============================================================

CREATE TABLE pedidos (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio              VARCHAR(20)  NOT NULL COMMENT 'PED-2025-0001',
  cotizacion_id      INT UNSIGNED NOT NULL,
  cliente_id         INT UNSIGNED NOT NULL,
  tipo_pago          ENUM('contado','credito') NOT NULL DEFAULT 'contado',
  fecha_entrega_prom DATE         NULL DEFAULT NULL,
  estatus            ENUM('confirmado','en_proceso','entregado','cancelado')
                                  NOT NULL DEFAULT 'confirmado',
  notas              TEXT         NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pedido_folio   (folio),
  KEY        idx_ped_cliente   (cliente_id),
  KEY        idx_ped_cotizacion (cotizacion_id),
  KEY        idx_ped_estatus   (estatus),
  CONSTRAINT fk_ped_cotizacion FOREIGN KEY (cotizacion_id)
    REFERENCES cotizaciones_cliente(id) ON UPDATE CASCADE,
  CONSTRAINT fk_ped_cliente    FOREIGN KEY (cliente_id)
    REFERENCES clientes(id)             ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pedido confirmado, nace de cotización aceptada';


-- ============================================================
--  9. FACTURACIÓN CFDI
-- ============================================================

CREATE TABLE facturas (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  pedido_id          INT UNSIGNED  NOT NULL,
  uuid_sat           VARCHAR(36)   NULL DEFAULT NULL COMMENT 'Folio fiscal UUID del SAT',
  serie              VARCHAR(5)    NULL DEFAULT 'A',
  folio_fiscal       VARCHAR(20)   NULL DEFAULT NULL,
  subtotal           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  iva                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  xml_path           VARCHAR(255)  NULL DEFAULT NULL COMMENT 'Ruta al XML timbrado',
  pdf_path           VARCHAR(255)  NULL DEFAULT NULL COMMENT 'Ruta al PDF de la factura',
  estatus_sat        ENUM('vigente','cancelada') NOT NULL DEFAULT 'vigente',
  motivo_cancelacion VARCHAR(200)  NULL DEFAULT NULL,
  -- DATETIME NULL en vez de TIMESTAMP NULL (más seguro en MariaDB)
  fecha_timbrado     DATETIME      NULL DEFAULT NULL,
  pac_nombre         VARCHAR(50)   NULL DEFAULT NULL COMMENT 'Nombre del PAC utilizado',
  created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_factura_uuid (uuid_sat),
  KEY        idx_fac_pedido  (pedido_id),
  KEY        idx_fac_estatus (estatus_sat),
  CONSTRAINT fk_fac_pedido FOREIGN KEY (pedido_id)
    REFERENCES pedidos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Facturas CFDI timbradas ante el SAT';


-- ============================================================
--  10. COBRANZA Y PAGOS
-- ============================================================

CREATE TABLE cobranza (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  factura_id        INT UNSIGNED  NOT NULL,
  cliente_id        INT UNSIGNED  NOT NULL,
  fecha_vencimiento DATE          NOT NULL,
  monto_total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  monto_pagado      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  saldo             DECIMAL(12,2) NOT NULL DEFAULT 0.00
                    COMMENT 'saldo = monto_total - monto_pagado',
  estatus           ENUM('pendiente','parcial','pagada','vencida')
                                  NOT NULL DEFAULT 'pendiente',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cob_factura     (factura_id),
  KEY idx_cob_cliente     (cliente_id),
  KEY idx_cob_vencimiento (fecha_vencimiento),
  KEY idx_cob_estatus     (estatus),
  CONSTRAINT fk_cob_factura FOREIGN KEY (factura_id)
    REFERENCES facturas(id)  ON UPDATE CASCADE,
  CONSTRAINT fk_cob_cliente  FOREIGN KEY (cliente_id)
    REFERENCES clientes(id)  ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Control de cuentas por cobrar por factura';


CREATE TABLE pagos (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cobranza_id      INT UNSIGNED  NOT NULL,
  fecha_pago       DATE          NOT NULL,
  monto            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  forma_pago       ENUM('transferencia','cheque','efectivo','tarjeta','otro')
                                 NOT NULL DEFAULT 'transferencia',
  referencia       VARCHAR(100)  NULL DEFAULT NULL COMMENT 'Nro. de transferencia o cheque',
  comprobante_path VARCHAR(255)  NULL DEFAULT NULL COMMENT 'Foto o PDF del comprobante',
  notas            VARCHAR(300)  NULL DEFAULT NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pago_cobranza (cobranza_id),
  KEY idx_pago_fecha    (fecha_pago),
  CONSTRAINT fk_pago_cobranza FOREIGN KEY (cobranza_id)
    REFERENCES cobranza(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pagos recibidos. Soporta pagos parciales.';


-- ============================================================
--  11. TABLAS DE INFRAESTRUCTURA
-- ============================================================

CREATE TABLE folios (
  serie  VARCHAR(10)       NOT NULL COMMENT 'SOL, COT, PED, SKU',
  anio   SMALLINT UNSIGNED NOT NULL,
  ultimo INT UNSIGNED      NOT NULL DEFAULT 0,
  PRIMARY KEY (serie, anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Generador de folios consecutivos por serie y año';

INSERT INTO folios (serie, anio, ultimo) VALUES
  ('SOL', YEAR(CURDATE()), 0),
  ('COT', YEAR(CURDATE()), 0),
  ('PED', YEAR(CURDATE()), 0),
  ('SKU', YEAR(CURDATE()), 0);


CREATE TABLE usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('admin','operador') NOT NULL DEFAULT 'operador',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Usuarios del sistema';

-- Reactivar FK checks
SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
--  12. VISTAS  (CREATE OR REPLACE para MariaDB)
-- ============================================================

CREATE OR REPLACE VIEW v_comparador_precios AS
SELECT
  s.id                                   AS solicitud_id,
  s.folio                                AS folio_solicitud,
  sp.id                                  AS partida_id,
  sp.linea,
  sp.descripcion_original,
  sp.codigo_cliente,
  sp.cantidad,
  sp.unidad_medida,
  sp.observaciones,
  sp.iva_exento,
  p.nombre_empresa                       AS proveedor,
  cpp.sku_proveedor,
  cpp.observaciones_proveedor,
  cpp.precio_unitario,
  cpp.disponible,
  cpp.es_mejor_precio,
  (cpp.precio_unitario * sp.cantidad)    AS importe_compra
FROM solicitudes s
JOIN solicitudes_partidas sp
  ON sp.solicitud_id = s.id
JOIN cotizaciones_proveedor cp
  ON cp.solicitud_id = s.id
JOIN proveedores p
  ON p.id = cp.proveedor_id
LEFT JOIN cotizaciones_proveedor_precios cpp
  ON  cpp.cotizacion_proveedor_id = cp.id
  AND cpp.partida_id = sp.id
ORDER BY s.id, sp.linea, cpp.precio_unitario;


CREATE OR REPLACE VIEW v_inventario AS
SELECT
  pr.id                                              AS producto_id,
  pr.sku_interno,
  pr.descripcion,
  pr.categoria,
  pr.unidad_medida,
  pr.stock_minimo,
  COALESCE(SUM(il.cantidad_actual), 0)               AS stock_total,
  MIN(il.fecha_caducidad)                            AS proxima_caducidad,
  DATEDIFF(MIN(il.fecha_caducidad), CURDATE())       AS dias_para_caducar,
  CASE
    WHEN MIN(il.fecha_caducidad) IS NULL                              THEN 'SIN_CADUCIDAD'
    WHEN MIN(il.fecha_caducidad) <= CURDATE()                        THEN 'CADUCADO'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 30          THEN 'ALERTA_30'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 60          THEN 'ALERTA_60'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 90          THEN 'ALERTA_90'
    ELSE 'OK'
  END                                                AS alerta_caducidad,
  CASE
    WHEN COALESCE(SUM(il.cantidad_actual), 0) <= pr.stock_minimo     THEN 'STOCK_BAJO'
    ELSE 'OK'
  END                                                AS alerta_stock
FROM productos pr
LEFT JOIN inventario_lotes il
  ON  il.producto_id     = pr.id
  AND il.cantidad_actual > 0
WHERE pr.activo = 1
GROUP BY
  pr.id, pr.sku_interno, pr.descripcion, pr.categoria,
  pr.unidad_medida, pr.stock_minimo;


CREATE OR REPLACE VIEW v_cuentas_por_cobrar AS
SELECT
  cob.id                                             AS cobranza_id,
  c.razon_social                                     AS cliente,
  f.folio_fiscal,
  f.total                                            AS monto_factura,
  cob.monto_pagado,
  cob.saldo,
  cob.fecha_vencimiento,
  DATEDIFF(CURDATE(), cob.fecha_vencimiento)         AS dias_vencido,
  cob.estatus,
  CASE
    WHEN cob.estatus = 'pagada'                                       THEN 'PAGADA'
    WHEN DATEDIFF(CURDATE(), cob.fecha_vencimiento) > 30             THEN 'VENCIDA_CRITICA'
    WHEN DATEDIFF(CURDATE(), cob.fecha_vencimiento) > 0              THEN 'VENCIDA'
    WHEN DATEDIFF(cob.fecha_vencimiento, CURDATE()) <= 7             THEN 'POR_VENCER'
    ELSE 'AL_CORRIENTE'
  END                                                AS semaforo
FROM cobranza cob
JOIN facturas f ON f.id  = cob.factura_id
JOIN clientes c ON c.id  = cob.cliente_id
WHERE cob.estatus <> 'pagada'
ORDER BY dias_vencido DESC;


-- ============================================================
--  13. STORED PROCEDURES
--
--  ⚠️  En phpMyAdmin:
--      Usar SIEMPRE "Importar → Seleccionar archivo"
--      NO copiar/pegar en el editor (el DELIMITER no funciona ahí)
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_generar_folio$$
CREATE PROCEDURE sp_generar_folio(
  IN  p_serie  VARCHAR(10),
  OUT p_folio  VARCHAR(20)
)
BEGIN
  DECLARE v_anio SMALLINT;
  DECLARE v_num  INT;

  SET v_anio = YEAR(CURDATE());

  -- Crear fila del año si no existe
  INSERT IGNORE INTO folios (serie, anio, ultimo)
  VALUES (p_serie, v_anio, 0);

  -- Incrementar contador
  UPDATE folios
     SET ultimo = ultimo + 1
   WHERE serie = p_serie
     AND anio  = v_anio;

  -- Leer valor actual
  SELECT ultimo INTO v_num
    FROM folios
   WHERE serie = p_serie
     AND anio  = v_anio;

  -- Formatear: SOL-2025-0001
  SET p_folio = CONCAT(p_serie, '-', v_anio, '-', LPAD(v_num, 4, '0'));
END$$


DROP PROCEDURE IF EXISTS sp_generar_sku$$
CREATE PROCEDURE sp_generar_sku(
  OUT p_sku VARCHAR(20)
)
BEGIN
  DECLARE v_num  INT;
  DECLARE v_anio SMALLINT;

  SET v_anio = YEAR(CURDATE());

  INSERT IGNORE INTO folios (serie, anio, ultimo)
  VALUES ('SKU', v_anio, 0);

  UPDATE folios
     SET ultimo = ultimo + 1
   WHERE serie = 'SKU'
     AND anio  = v_anio;

  SELECT ultimo INTO v_num
    FROM folios
   WHERE serie = 'SKU'
     AND anio  = v_anio;

  -- Formato permanente sin año: DM-00001
  SET p_sku = CONCAT('DM-', LPAD(v_num, 5, '0'));
END$$

DELIMITER ;


-- ============================================================
--  PROVEEDORES_CATALOGO  (migrate_v10.js, 2026-06-16)
--  Tarifario por proveedor + equivalencia a SKU INNOVACOM.
--  PK COMPUESTA (proveedor_id, sku_proveedor) — sin autonumérico.
-- ============================================================
CREATE TABLE IF NOT EXISTS proveedores_catalogo (
  proveedor_id          INT UNSIGNED  NOT NULL
                        COMMENT 'FK -> proveedores.id; el nombre vive en proveedores.nombre_empresa',
  sku_proveedor         VARCHAR(40)   NOT NULL
                        COMMENT 'Codigo del proveedor, ej. Pronamac "AMB 091" (unico por proveedor)',
  referencia_fabricante VARCHAR(80)   NULL
                        COMMENT 'Ref./codigo del fabricante',
  descripcion           VARCHAR(800)  NULL
                        COMMENT 'Descripcion del tarifario',
  unidad_medida         VARCHAR(20)   NULL
                        COMMENT 'PIEZA / CAJA / PAQUETE / PAR / SOBRE / KIT',
  precio_lista          DECIMAL(12,2) NULL
                        COMMENT 'Precio de lista sin IVA',
  moneda                CHAR(3)       NOT NULL DEFAULT 'MXN',
  vigencia              VARCHAR(20)   NULL
                        COMMENT 'Periodo del tarifario, ej. FEBRERO 2026',
  sku_innovacom         VARCHAR(20)   NULL
                        COMMENT 'Codigo INNOVACOM equivalente (texto del archivo de equivalencias)',
  producto_id           INT UNSIGNED  NULL
                        COMMENT 'FK -> productos.id; se resuelve cuando el producto exista en catalogo',
  match_estado          ENUM('sin_vincular','sugerido','confirmado')
                        NOT NULL DEFAULT 'sin_vincular',
  activo                TINYINT(1)    NOT NULL DEFAULT 1,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (proveedor_id, sku_proveedor),
  KEY idx_pcat_ref       (referencia_fabricante),
  KEY idx_pcat_innovacom (sku_innovacom),
  KEY idx_pcat_producto  (producto_id),
  CONSTRAINT fk_pcat_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pcat_producto  FOREIGN KEY (producto_id)
    REFERENCES productos(id)   ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tarifario por proveedor con equivalencia a SKU INNOVACOM';


-- ============================================================
--  ✅ FIN DEL SCRIPT
--     Tablas:          17 (16 de negocio + usuarios)
--     Vistas:           3
--     Stored Procedures: 2
-- ============================================================
