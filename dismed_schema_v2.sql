-- ============================================================
--  SISTEMA DE DISTRIBUCIÓN MÉDICA — ESQUEMA BD v2
--  Motor: MySQL 8.0+
--  Generado: 2025-05-01
--  Notas:
--    · Ejecutar como usuario con privilegios CREATE/ALTER
--    · Cambia `dismed_db` por el nombre real de tu base
--    · Todas las tablas usan InnoDB y UTF-8
-- ============================================================

CREATE DATABASE IF NOT EXISTS dismed_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE dismed_db;

-- ============================================================
--  1. CLIENTES
-- ============================================================

CREATE TABLE clientes (
  id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  razon_social     VARCHAR(200)    NOT NULL,
  nombre_comercial VARCHAR(200)    NULL,
  rfc              VARCHAR(13)     NOT NULL,
  regimen_fiscal   VARCHAR(100)    NULL COMMENT 'Para CFDI 4.0',
  uso_cfdi         VARCHAR(10)     NULL COMMENT 'Clave SAT, ej: G03',
  tipo_cliente     ENUM('hospital','clinica','farmacia','laboratorio','gobierno','otro')
                                   NOT NULL DEFAULT 'otro',
  limite_credito   DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  dias_credito     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  direccion_fiscal TEXT            NULL,
  activo           TINYINT(1)      NOT NULL DEFAULT 1,
  notas            TEXT            NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cliente_rfc (rfc),
  KEY idx_cliente_tipo (tipo_cliente),
  KEY idx_cliente_activo (activo)
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
  COMMENT='Contactos por cliente (compras, pagos, etc.)';


-- ============================================================
--  2. PROVEEDORES
-- ============================================================

CREATE TABLE proveedores (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre_empresa      VARCHAR(200) NOT NULL,
  nombre_contacto     VARCHAR(150) NULL COMMENT 'Persona de contacto principal',
  puesto_contacto     VARCHAR(100) NULL,
  rfc                 VARCHAR(13)  NULL,
  email_cotizaciones  VARCHAR(150) NULL,
  telefono            VARCHAR(20)  NULL,
  whatsapp            VARCHAR(20)  NULL,
  dias_entrega_prom   TINYINT UNSIGNED NOT NULL DEFAULT 3
                      COMMENT 'Promedio real, se actualiza con historial',
  notas               TEXT         NULL,
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prov_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Proveedores de insumos médicos';


CREATE TABLE proveedores_categorias (
  proveedor_id INT UNSIGNED NOT NULL,
  categoria    ENUM('medicamento','material_curacion','ropa_hospital',
                    'equipo_clinica','laboratorio','detergente','otro')
               NOT NULL,
  PRIMARY KEY (proveedor_id, categoria),
  CONSTRAINT fk_pc_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Categorías que maneja cada proveedor';


-- ============================================================
--  3. PRODUCTOS E INVENTARIO
--     sku_interno es la llave maestra de todo el sistema
-- ============================================================

CREATE TABLE productos (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sku_interno      VARCHAR(20)   NOT NULL COMMENT 'Formato DM-00001, generado automáticamente',
  descripcion      VARCHAR(300)  NOT NULL,
  descripcion_corta VARCHAR(100) NULL COMMENT 'Para PDF de cotización',
  categoria        ENUM('medicamento','material_curacion','ropa_hospital',
                        'equipo_clinica','laboratorio','detergente','otro')
                                 NOT NULL DEFAULT 'otro',
  unidad_medida    VARCHAR(30)   NOT NULL DEFAULT 'pza',
  clave_sat        VARCHAR(10)   NULL COMMENT 'Clave producto/servicio SAT para CFDI',
  clave_unidad_sat VARCHAR(6)    NULL COMMENT 'Clave unidad SAT, ej: H87 (pieza)',
  stock_minimo     DECIMAL(10,2) NOT NULL DEFAULT 0,
  activo           TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sku_interno (sku_interno),
  KEY idx_prod_categoria (categoria),
  KEY idx_prod_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo interno de productos. sku_interno es el eje de todo el sistema.';


CREATE TABLE inventario_lotes (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  producto_id      INT UNSIGNED  NOT NULL,
  proveedor_id     INT UNSIGNED  NULL COMMENT 'Proveedor del que se compró este lote',
  numero_lote      VARCHAR(50)   NULL,
  fecha_caducidad  DATE          NULL,
  cantidad_inicial DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_actual  DECIMAL(10,2) NOT NULL DEFAULT 0,
  costo_unitario   DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha_entrada    DATE          NOT NULL,
  notas            VARCHAR(300)  NULL,
  PRIMARY KEY (id),
  KEY idx_lote_producto (producto_id),
  KEY idx_lote_caducidad (fecha_caducidad) COMMENT 'Para alertas de vencimiento próximo',
  KEY idx_lote_proveedor (proveedor_id),
  CONSTRAINT fk_lote_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON UPDATE CASCADE,
  CONSTRAINT fk_lote_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lotes de inventario con trazabilidad por caducidad. FIFO en salidas.';


-- ============================================================
--  4. DICCIONARIOS DE EQUIVALENCIAS DE CÓDIGOS
-- ============================================================

CREATE TABLE clientes_skus (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id          INT UNSIGNED NOT NULL,
  sku_cliente         VARCHAR(80)  NOT NULL COMMENT 'Código exacto que usa el cliente',
  descripcion_cliente VARCHAR(300) NULL     COMMENT 'Descripción original del cliente',
  producto_id         INT UNSIGNED NULL     COMMENT 'Equivalencia con nuestro catálogo',
  confirmado          TINYINT(1)   NOT NULL DEFAULT 0
                      COMMENT '0=sugerencia automática, 1=confirmado por el usuario',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cliente_sku (cliente_id, sku_cliente),
  KEY idx_csku_producto (producto_id),
  CONSTRAINT fk_csku_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_csku_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Diccionario: código del cliente → nuestro sku_interno';


CREATE TABLE proveedores_skus (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  proveedor_id          INT UNSIGNED NOT NULL,
  sku_proveedor         VARCHAR(80)  NOT NULL COMMENT 'Código exacto del proveedor',
  descripcion_proveedor VARCHAR(300) NULL,
  producto_id           INT UNSIGNED NULL     COMMENT 'Equivalencia con nuestro catálogo',
  ultimo_precio         DECIMAL(12,2) NULL,
  ultima_cotizacion     DATE          NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prov_sku (proveedor_id, sku_proveedor),
  KEY idx_psku_producto (producto_id),
  CONSTRAINT fk_psku_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_psku_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Diccionario: código del proveedor → nuestro sku_interno';


-- ============================================================
--  5. SOLICITUDES DEL CLIENTE
-- ============================================================

CREATE TABLE solicitudes (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio             VARCHAR(20)  NOT NULL COMMENT 'SOL-2025-0001',
  cliente_id        INT UNSIGNED NOT NULL,
  contacto_id       INT UNSIGNED NULL,
  referencia_cliente VARCHAR(100) NULL COMMENT 'Número de requisición del cliente',
  archivo_origen    VARCHAR(255) NULL COMMENT 'Nombre del archivo subido',
  tipo_origen       ENUM('excel','pdf','manual') NOT NULL DEFAULT 'manual',
  estatus           ENUM('nueva','cotizando','cotizada','pedido','cancelada')
                    NOT NULL DEFAULT 'nueva',
  notas             TEXT         NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_solicitud_folio (folio),
  KEY idx_sol_cliente (cliente_id),
  KEY idx_sol_estatus (estatus),
  CONSTRAINT fk_sol_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON UPDATE CASCADE,
  CONSTRAINT fk_sol_contacto FOREIGN KEY (contacto_id)
    REFERENCES clientes_contactos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encabezado de solicitud de cotización recibida del cliente';


CREATE TABLE solicitudes_partidas (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  solicitud_id          INT UNSIGNED  NOT NULL,
  linea                 SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Número de renglón',
  codigo_cliente        VARCHAR(80)   NULL COMMENT 'Código tal como viene del cliente',
  descripcion_original  VARCHAR(300)  NOT NULL COMMENT 'Texto exacto del cliente sin modificar',
  producto_id           INT UNSIGNED  NULL COMMENT 'Resuelto automático o manual',
  cantidad              DECIMAL(10,2) NOT NULL DEFAULT 1,
  unidad_medida         VARCHAR(30)   NOT NULL DEFAULT 'pza',
  observaciones         TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_sp_solicitud (solicitud_id),
  KEY idx_sp_codigo_cliente (codigo_cliente),
  KEY idx_sp_producto (producto_id),
  CONSTRAINT fk_sp_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sp_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Partidas de la solicitud del cliente. código_cliente guardado tal cual.';


-- ============================================================
--  6. COTIZACIONES A PROVEEDORES Y COMPARADOR
-- ============================================================

CREATE TABLE cotizaciones_proveedor (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  solicitud_id     INT UNSIGNED NOT NULL,
  proveedor_id     INT UNSIGNED NOT NULL,
  estatus          ENUM('solicitada','recibida','vencida') NOT NULL DEFAULT 'solicitada',
  fecha_solicitud  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_respuesta  TIMESTAMP    NULL,
  notas            TEXT         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cot_prov_solicitud (solicitud_id, proveedor_id),
  KEY idx_cp_proveedor (proveedor_id),
  KEY idx_cp_estatus (estatus),
  CONSTRAINT fk_cp_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cp_proveedor FOREIGN KEY (proveedor_id)
    REFERENCES proveedores(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Una fila por proveedor consultado en cada solicitud';


CREATE TABLE cotizaciones_proveedor_precios (
  id                      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cotizacion_proveedor_id INT UNSIGNED  NOT NULL,
  partida_id              INT UNSIGNED  NOT NULL,
  sku_proveedor           VARCHAR(80)   NULL COMMENT 'Código del proveedor para este producto',
  descripcion_proveedor   VARCHAR(300)  NULL COMMENT 'Descripción tal como la da el proveedor',
  precio_unitario         DECIMAL(12,2) NULL COMMENT 'NULL = no disponible',
  disponible              TINYINT(1)    NOT NULL DEFAULT 1,
  es_mejor_precio         TINYINT(1)   NOT NULL DEFAULT 0
                          COMMENT 'Calculado automáticamente al comparar',
  PRIMARY KEY (id),
  UNIQUE KEY uq_cpp_cot_partida (cotizacion_proveedor_id, partida_id),
  KEY idx_cpp_partida (partida_id),
  KEY idx_cpp_sku_prov (sku_proveedor),
  CONSTRAINT fk_cpp_cotizacion FOREIGN KEY (cotizacion_proveedor_id)
    REFERENCES cotizaciones_proveedor(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cpp_partida FOREIGN KEY (partida_id)
    REFERENCES solicitudes_partidas(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Precio por proveedor por partida. Alimenta proveedores_skus automáticamente.';


-- ============================================================
--  7. COTIZACIONES AL CLIENTE
-- ============================================================

CREATE TABLE cotizaciones_cliente (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  folio            VARCHAR(20)   NOT NULL COMMENT 'COT-2025-0001',
  solicitud_id     INT UNSIGNED  NOT NULL,
  cliente_id       INT UNSIGNED  NOT NULL,
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva              DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  condicion_pago   VARCHAR(50)   NULL DEFAULT 'Contado',
  dias_credito     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  dias_vigencia    TINYINT UNSIGNED NOT NULL DEFAULT 10,
  tiempo_entrega   VARCHAR(100)  NULL DEFAULT '3 a 5 días hábiles',
  estatus          ENUM('borrador','enviada','aceptada','rechazada','vencida')
                   NOT NULL DEFAULT 'borrador',
  pdf_path         VARCHAR(255)  NULL,
  notas            TEXT          NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cot_cli_folio (folio),
  KEY idx_cc_cliente (cliente_id),
  KEY idx_cc_solicitud (solicitud_id),
  KEY idx_cc_estatus (estatus),
  CONSTRAINT fk_cotcli_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES solicitudes(id) ON UPDATE CASCADE,
  CONSTRAINT fk_cotcli_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Encabezado de cotización enviada al cliente';


CREATE TABLE cotizaciones_cliente_partidas (
  id                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cotizacion_id         INT UNSIGNED  NOT NULL,
  partida_solicitud_id  INT UNSIGNED  NULL COMMENT 'Referencia a solicitud original',
  producto_id           INT UNSIGNED  NULL,
  sku_interno           VARCHAR(20)   NULL COMMENT 'Copia de productos.sku_interno',
  codigo_cliente        VARCHAR(80)   NULL COMMENT 'Código del cliente, para mostrarlo en PDF',
  linea                 SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  descripcion           VARCHAR(300)  NOT NULL,
  cantidad              DECIMAL(10,2) NOT NULL DEFAULT 1,
  unidad_medida         VARCHAR(30)   NOT NULL DEFAULT 'pza',
  precio_compra         DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Precio del mejor proveedor',
  margen_pct            DECIMAL(5,2)  NOT NULL DEFAULT 0 COMMENT '% de ganancia aplicado',
  precio_unitario_venta DECIMAL(12,2) NOT NULL DEFAULT 0,
  importe               DECIMAL(12,2) NOT NULL DEFAULT 0,
  observaciones         TEXT          NULL,
  PRIMARY KEY (id),
  KEY idx_ccp_cotizacion (cotizacion_id),
  KEY idx_ccp_producto (producto_id),
  KEY idx_ccp_sku (sku_interno),
  CONSTRAINT fk_ccp_cotizacion FOREIGN KEY (cotizacion_id)
    REFERENCES cotizaciones_cliente(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ccp_partida FOREIGN KEY (partida_solicitud_id)
    REFERENCES solicitudes_partidas(id) ON UPDATE CASCADE,
  CONSTRAINT fk_ccp_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id) ON UPDATE CASCADE
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
  fecha_entrega_prom DATE         NULL,
  estatus            ENUM('confirmado','en_proceso','entregado','cancelado')
                     NOT NULL DEFAULT 'confirmado',
  notas              TEXT         NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pedido_folio (folio),
  KEY idx_ped_cliente (cliente_id),
  KEY idx_ped_estatus (estatus),
  CONSTRAINT fk_ped_cotizacion FOREIGN KEY (cotizacion_id)
    REFERENCES cotizaciones_cliente(id) ON UPDATE CASCADE,
  CONSTRAINT fk_ped_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pedido confirmado, nace de cotización aceptada';


-- ============================================================
--  9. FACTURACIÓN CFDI
-- ============================================================

CREATE TABLE facturas (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  pedido_id        INT UNSIGNED  NOT NULL,
  uuid_sat         VARCHAR(36)   NULL COMMENT 'Folio fiscal UUID del SAT',
  serie            VARCHAR(5)    NULL DEFAULT 'A',
  folio_fiscal     VARCHAR(20)   NULL,
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  iva              DECIMAL(12,2) NOT NULL DEFAULT 0,
  total            DECIMAL(12,2) NOT NULL DEFAULT 0,
  xml_path         VARCHAR(255)  NULL COMMENT 'Ruta al XML timbrado',
  pdf_path         VARCHAR(255)  NULL COMMENT 'Ruta al PDF de la factura',
  estatus_sat      ENUM('vigente','cancelada') NOT NULL DEFAULT 'vigente',
  motivo_cancelacion VARCHAR(200) NULL,
  fecha_timbrado   TIMESTAMP     NULL,
  pac_nombre       VARCHAR(50)   NULL COMMENT 'Nombre del PAC utilizado',
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_factura_uuid (uuid_sat),
  KEY idx_fac_pedido (pedido_id),
  KEY idx_fac_estatus (estatus_sat),
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
  monto_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_pagado      DECIMAL(12,2) NOT NULL DEFAULT 0,
  saldo             DECIMAL(12,2) NOT NULL DEFAULT 0
                    COMMENT 'saldo = monto_total - monto_pagado, actualizar en cada pago',
  estatus           ENUM('pendiente','parcial','pagada','vencida')
                    NOT NULL DEFAULT 'pendiente',
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cob_factura (factura_id),
  KEY idx_cob_cliente (cliente_id),
  KEY idx_cob_vencimiento (fecha_vencimiento) COMMENT 'Para alertas de CxC vencida',
  KEY idx_cob_estatus (estatus),
  CONSTRAINT fk_cob_factura FOREIGN KEY (factura_id)
    REFERENCES facturas(id) ON UPDATE CASCADE,
  CONSTRAINT fk_cob_cliente FOREIGN KEY (cliente_id)
    REFERENCES clientes(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Control de cuentas por cobrar por factura';


CREATE TABLE pagos (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  cobranza_id      INT UNSIGNED  NOT NULL,
  fecha_pago       DATE          NOT NULL,
  monto            DECIMAL(12,2) NOT NULL DEFAULT 0,
  forma_pago       ENUM('transferencia','cheque','efectivo','tarjeta','otro')
                   NOT NULL DEFAULT 'transferencia',
  referencia       VARCHAR(100)  NULL COMMENT 'Número de transferencia o cheque',
  comprobante_path VARCHAR(255)  NULL COMMENT 'Foto o PDF del comprobante',
  notas            VARCHAR(300)  NULL,
  created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pago_cobranza (cobranza_id),
  KEY idx_pago_fecha (fecha_pago),
  CONSTRAINT fk_pago_cobranza FOREIGN KEY (cobranza_id)
    REFERENCES cobranza(id) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pagos recibidos. Soporta pagos parciales.';


-- ============================================================
--  11. CATÁLOGO DE FOLIOS (generador automático)
-- ============================================================

CREATE TABLE folios (
  serie      VARCHAR(10)      NOT NULL COMMENT 'SOL, COT, PED, SKU',
  anio       SMALLINT UNSIGNED NOT NULL,
  ultimo     INT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (serie, anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Generador de folios consecutivos por serie y año';

-- Insertar series iniciales
INSERT INTO folios (serie, anio, ultimo) VALUES
  ('SOL', YEAR(CURDATE()), 0),
  ('COT', YEAR(CURDATE()), 0),
  ('PED', YEAR(CURDATE()), 0),
  ('SKU', YEAR(CURDATE()), 0);


-- ============================================================
--  12. STORED PROCEDURE — Generar folio
-- ============================================================

DELIMITER $$

CREATE PROCEDURE sp_generar_folio(
  IN  p_serie   VARCHAR(10),
  OUT p_folio   VARCHAR(20)
)
BEGIN
  DECLARE v_anio  SMALLINT;
  DECLARE v_num   INT;

  SET v_anio = YEAR(CURDATE());

  -- Insertar año si no existe
  INSERT IGNORE INTO folios (serie, anio, ultimo) VALUES (p_serie, v_anio, 0);

  -- Incrementar y obtener
  UPDATE folios SET ultimo = ultimo + 1
   WHERE serie = p_serie AND anio = v_anio;

  SELECT ultimo INTO v_num
    FROM folios
   WHERE serie = p_serie AND anio = v_anio;

  SET p_folio = CONCAT(p_serie, '-', v_anio, '-', LPAD(v_num, 4, '0'));
END$$

DELIMITER ;


-- ============================================================
--  13. STORED PROCEDURE — Generar SKU interno
-- ============================================================

DELIMITER $$

CREATE PROCEDURE sp_generar_sku(
  OUT p_sku VARCHAR(20)
)
BEGIN
  DECLARE v_num INT;
  DECLARE v_anio SMALLINT;
  SET v_anio = YEAR(CURDATE());

  INSERT IGNORE INTO folios (serie, anio, ultimo) VALUES ('SKU', v_anio, 0);
  UPDATE folios SET ultimo = ultimo + 1 WHERE serie = 'SKU' AND anio = v_anio;
  SELECT ultimo INTO v_num FROM folios WHERE serie = 'SKU' AND anio = v_anio;

  -- Formato: DM-00001 (sin año, es permanente)
  SET p_sku = CONCAT('DM-', LPAD(v_num, 5, '0'));
END$$

DELIMITER ;


-- ============================================================
--  14. VISTA — Comparador de precios por solicitud
-- ============================================================

CREATE VIEW v_comparador_precios AS
SELECT
  s.id                          AS solicitud_id,
  s.folio                       AS folio_solicitud,
  sp.id                         AS partida_id,
  sp.linea,
  sp.descripcion_original,
  sp.codigo_cliente,
  sp.cantidad,
  sp.unidad_medida,
  p.nombre_empresa              AS proveedor,
  cpp.sku_proveedor,
  cpp.precio_unitario,
  cpp.disponible,
  cpp.es_mejor_precio,
  (cpp.precio_unitario * sp.cantidad) AS importe_compra
FROM solicitudes s
JOIN solicitudes_partidas sp       ON sp.solicitud_id = s.id
JOIN cotizaciones_proveedor cp     ON cp.solicitud_id = s.id
JOIN proveedores p                 ON p.id = cp.proveedor_id
LEFT JOIN cotizaciones_proveedor_precios cpp
                                   ON cpp.cotizacion_proveedor_id = cp.id
                                  AND cpp.partida_id = sp.id
ORDER BY s.id, sp.linea, cpp.precio_unitario;


-- ============================================================
--  15. VISTA — Inventario consolidado con alertas
-- ============================================================

CREATE VIEW v_inventario AS
SELECT
  pr.sku_interno,
  pr.descripcion,
  pr.categoria,
  pr.unidad_medida,
  pr.stock_minimo,
  SUM(il.cantidad_actual)                  AS stock_total,
  MIN(il.fecha_caducidad)                  AS proxima_caducidad,
  DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) AS dias_para_caducar,
  CASE
    WHEN MIN(il.fecha_caducidad) <= CURDATE()              THEN 'CADUCADO'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 30 THEN 'ALERTA_30'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 60 THEN 'ALERTA_60'
    WHEN DATEDIFF(MIN(il.fecha_caducidad), CURDATE()) <= 90 THEN 'ALERTA_90'
    ELSE 'OK'
  END                                      AS alerta_caducidad,
  CASE
    WHEN SUM(il.cantidad_actual) <= pr.stock_minimo THEN 'STOCK_BAJO'
    ELSE 'OK'
  END                                      AS alerta_stock
FROM productos pr
LEFT JOIN inventario_lotes il ON il.producto_id = pr.id AND il.cantidad_actual > 0
WHERE pr.activo = 1
GROUP BY pr.id;


-- ============================================================
--  16. VISTA — Cuentas por cobrar vencidas y próximas
-- ============================================================

CREATE VIEW v_cuentas_por_cobrar AS
SELECT
  c.razon_social                           AS cliente,
  f.folio_fiscal,
  f.total                                  AS monto_factura,
  cob.monto_pagado,
  cob.saldo,
  cob.fecha_vencimiento,
  DATEDIFF(CURDATE(), cob.fecha_vencimiento) AS dias_vencido,
  cob.estatus,
  CASE
    WHEN cob.estatus = 'pagada'                              THEN 'PAGADA'
    WHEN DATEDIFF(CURDATE(), cob.fecha_vencimiento) > 30    THEN 'VENCIDA_CRITICA'
    WHEN DATEDIFF(CURDATE(), cob.fecha_vencimiento) > 0     THEN 'VENCIDA'
    WHEN DATEDIFF(cob.fecha_vencimiento, CURDATE()) <= 7    THEN 'POR_VENCER'
    ELSE 'AL_CORRIENTE'
  END                                      AS semaforo
FROM cobranza cob
JOIN facturas f   ON f.id = cob.factura_id
JOIN clientes c   ON c.id = cob.cliente_id
WHERE cob.estatus != 'pagada'
ORDER BY dias_vencido DESC;


-- ============================================================
--  FIN DEL SCRIPT
--  Tablas creadas: 15
--  Vistas creadas:  3
--  Procedimientos:  2
-- ============================================================
