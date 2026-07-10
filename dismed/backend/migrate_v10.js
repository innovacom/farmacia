/**
 * Migración v10 — node migrate_v10.js
 * Catálogo/tarifario por proveedor con equivalencia a SKU INNOVACOM.
 *
 *   Tabla `proveedores_catalogo`:
 *     - Llave primaria COMPUESTA (proveedor_id, sku_proveedor) — sin autonumérico.
 *       El proveedor se identifica con proveedor_id (FK → proveedores); su NOMBRE
 *       vive una sola vez en `proveedores.nombre_empresa`.
 *     - sku_proveedor      = código del proveedor (ej. Pronamac "AMB 091"), único por proveedor.
 *     - referencia_fabricante = ref./código del fabricante (puede venir vacío).
 *     - sku_innovacom      = código INNOVACOM dado en el archivo de equivalencias (texto directo).
 *     - producto_id        = FK opcional → productos.id; se resuelve cuando el producto exista.
 *     - descripcion/unidad_medida/precio_lista quedan NULLABLE: se cargan después
 *       desde una fuente tabular confiable (NO del volcado PDF).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('proveedores_catalogo (tabla)', `
    CREATE TABLE IF NOT EXISTS proveedores_catalogo (
      proveedor_id          INT UNSIGNED  NOT NULL
                            COMMENT 'FK → proveedores.id; el nombre vive en proveedores.nombre_empresa',
      sku_proveedor         VARCHAR(40)   NOT NULL
                            COMMENT 'Código del proveedor, ej. Pronamac "AMB 091" (único por proveedor)',
      referencia_fabricante VARCHAR(80)   NULL
                            COMMENT 'Ref./código del fabricante, ej. 2001010, MN1616, "3500183/1300"',
      descripcion           VARCHAR(800)  NULL
                            COMMENT 'Descripción del tarifario (se carga desde fuente tabular confiable)',
      unidad_medida         VARCHAR(20)   NULL
                            COMMENT 'PIEZA / CAJA / PAR / KIT',
      precio_lista          DECIMAL(12,2) NULL
                            COMMENT 'Precio de lista sin IVA',
      moneda                CHAR(3)       NOT NULL DEFAULT 'MXN',
      vigencia              VARCHAR(20)   NULL
                            COMMENT 'Periodo del tarifario, ej. FEBRERO 2026',

      -- ── EQUIVALENCIA DE SKUs ──
      sku_innovacom         VARCHAR(20)   NULL
                            COMMENT 'Código INNOVACOM (texto del archivo de equivalencias)',
      producto_id           INT UNSIGNED  NULL
                            COMMENT 'FK → productos.id; se resuelve cuando el producto exista en catálogo',
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
      COMMENT='Tarifario por proveedor con equivalencia a SKU INNOVACOM'
  `);

  console.log('\nMigración v10 terminada.');
  process.exit(0);
})();
