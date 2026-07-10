/**
 * Migración v6 — node migrate_v6.js
 * INVENTARIO Entrega 2 — Almacenes, ubicaciones, existencias por lote y kardex.
 *
 *   · almacenes, ubicaciones (NUEVAS)
 *   · inventario_lotes (EXTENDER): almacen_id, ubicacion_id, es_generico + UNIQUE
 *   · inventario_movimientos (NUEVA — kardex)
 *   · vistas v_existencias, v_stock_producto + actualizar v_inventario
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('almacenes', `
    CREATE TABLE IF NOT EXISTS almacenes (
      id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
      codigo    VARCHAR(20)  NOT NULL,
      nombre    VARCHAR(120) NOT NULL,
      direccion VARCHAR(300) NULL,
      activo    TINYINT(1)   NOT NULL DEFAULT 1,
      created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_almacen_codigo (codigo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('ubicaciones', `
    CREATE TABLE IF NOT EXISTS ubicaciones (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      almacen_id  INT UNSIGNED NOT NULL,
      codigo      VARCHAR(40)  NOT NULL,
      descripcion VARCHAR(150) NULL,
      tipo        ENUM('zona','rack','tarima','anaquel','piso','otro') NOT NULL DEFAULT 'otro',
      activo      TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_alm_ubic (almacen_id, codigo),
      CONSTRAINT fk_ubic_almacen FOREIGN KEY (almacen_id)
        REFERENCES almacenes(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Extender inventario_lotes
  const lcols = [
    ['almacen_id',   'INT UNSIGNED NULL'],
    ['ubicacion_id', 'INT UNSIGNED NULL'],
    ['es_generico',  'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const [n, d] of lcols) {
    await run(`inventario_lotes.${n}`,
      `ALTER TABLE inventario_lotes ADD COLUMN IF NOT EXISTS ${n} ${d}`);
  }
  // UNIQUE (producto, lote, ubicacion) — best-effort
  {
    const [[u]] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='inventario_lotes' AND INDEX_NAME='uq_lote_ubic'`);
    if (u.n === 0) await run('inventario_lotes.uq_lote_ubic',
      `ALTER TABLE inventario_lotes ADD UNIQUE KEY uq_lote_ubic (producto_id, numero_lote, ubicacion_id)`);
    else console.log('INFO uq_lote_ubic ya existe');
  }
  // FKs almacen/ubicacion en lotes
  for (const [name, col, ref] of [
    ['fk_lote_almacen',   'almacen_id',   'almacenes(id)'],
    ['fk_lote_ubicacion', 'ubicacion_id', 'ubicaciones(id)'],
  ]) {
    const [[e]] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventario_lotes' AND CONSTRAINT_NAME=?`, [name]);
    if (e.n === 0) await run(name,
      `ALTER TABLE inventario_lotes ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ${ref} ON UPDATE CASCADE`);
    else console.log('INFO ' + name + ' ya existe');
  }

  await run('inventario_movimientos', `
    CREATE TABLE IF NOT EXISTS inventario_movimientos (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      folio                VARCHAR(20)  NOT NULL,
      tipo                 ENUM('entrada','salida','traspaso','ajuste') NOT NULL,
      producto_id          INT UNSIGNED NOT NULL,
      lote_id              INT UNSIGNED NULL,
      lote_destino_id      INT UNSIGNED NULL,
      ubicacion_origen_id  INT UNSIGNED NULL,
      ubicacion_destino_id INT UNSIGNED NULL,
      cantidad             DECIMAL(10,2) NOT NULL,
      costo_unitario       DECIMAL(12,2) NOT NULL DEFAULT 0,
      motivo               VARCHAR(200) NULL,
      referencia           VARCHAR(60)  NULL,
      usuario_id           INT UNSIGNED NULL,
      created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_mov_producto (producto_id),
      KEY idx_mov_tipo_fecha (tipo, created_at),
      CONSTRAINT fk_mov_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Vistas
  await run('v_existencias', `
    CREATE OR REPLACE VIEW v_existencias AS
    SELECT
      il.id                AS lote_id,
      il.producto_id,
      p.sku_interno,
      p.descripcion,
      p.control_lote_caducidad,
      p.unidad_medida,
      il.numero_lote,
      il.es_generico,
      il.fecha_caducidad,
      il.almacen_id,
      a.nombre             AS almacen,
      il.ubicacion_id,
      u.codigo             AS ubicacion,
      il.cantidad_actual,
      il.costo_unitario,
      (il.cantidad_actual * il.costo_unitario) AS valor,
      DATEDIFF(il.fecha_caducidad, CURDATE())   AS dias_caducidad,
      CASE
        WHEN il.fecha_caducidad IS NULL                          THEN 'SIN_CADUCIDAD'
        WHEN il.fecha_caducidad <= CURDATE()                     THEN 'CADUCADO'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 30       THEN 'ALERTA_30'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 60       THEN 'ALERTA_60'
        WHEN DATEDIFF(il.fecha_caducidad, CURDATE()) <= 90       THEN 'ALERTA_90'
        ELSE 'OK'
      END                  AS estado_caducidad
    FROM inventario_lotes il
    JOIN productos p        ON p.id = il.producto_id
    LEFT JOIN almacenes a   ON a.id = il.almacen_id
    LEFT JOIN ubicaciones u ON u.id = il.ubicacion_id`);

  await run('v_stock_producto', `
    CREATE OR REPLACE VIEW v_stock_producto AS
    SELECT
      p.id                 AS producto_id,
      p.sku_interno,
      p.descripcion,
      p.unidad_medida,
      p.stock_minimo,
      p.control_lote_caducidad,
      COALESCE(SUM(il.cantidad_actual), 0)        AS stock_total,
      COALESCE(SUM(il.cantidad_actual * il.costo_unitario), 0) AS valor_total,
      MIN(NULLIF(il.fecha_caducidad, '0000-00-00')) AS proxima_caducidad,
      CASE WHEN COALESCE(SUM(il.cantidad_actual),0) <= p.stock_minimo THEN 1 ELSE 0 END AS stock_bajo
    FROM productos p
    LEFT JOIN inventario_lotes il ON il.producto_id = p.id AND il.cantidad_actual > 0
    WHERE p.activo = 1
    GROUP BY p.id, p.sku_interno, p.descripcion, p.unidad_medida, p.stock_minimo, p.control_lote_caducidad`);

  console.log('\nMigración v6 terminada.');
  process.exit(0);
})();
