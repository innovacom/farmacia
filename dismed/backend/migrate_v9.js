/**
 * Migración v9 — node migrate_v9.js
 * Vinculación de producto — Fases 3 y 4.
 *
 *   F3.1  productos.descripcion_norm + índice FULLTEXT (búsqueda difusa).
 *         Se puebla desde Node con matcher.normalizar (la normalización vive en JS).
 *   F3.2  solicitudes_partidas.match_estado / match_score / match_origen
 *         + v_comparador_precios expone match_estado/match_score.
 *   F3.3  productos.clave_cuadro_basico (+índice) para auto-vínculo por código de gobierno.
 *   F4.2  ordenes_compra_partidas.sku_proveedor (código del proveedor en la OC).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS + chequeo de índices en information_schema.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');
const { normalizar } = require('./src/modules/solicitudes/matcher');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

async function indiceExiste(tabla, indice) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tabla, indice]
  );
  return r.n > 0;
}

(async () => {
  // ── F3.1 — columna normalizada + FULLTEXT ─────────────────────────────────
  await run('productos.descripcion_norm',
    `ALTER TABLE productos ADD COLUMN IF NOT EXISTS descripcion_norm VARCHAR(800) NULL`);

  // Poblar descripcion_norm reutilizando la normalización del matcher (JS).
  {
    const [rows] = await pool.query(
      `SELECT id, descripcion FROM productos
       WHERE descripcion IS NOT NULL
         AND (descripcion_norm IS NULL OR descripcion_norm = '')`
    );
    let n = 0;
    for (const r of rows) {
      const norm = normalizar(r.descripcion).substring(0, 800);
      await pool.query('UPDATE productos SET descripcion_norm = ? WHERE id = ?', [norm, r.id]);
      n++;
    }
    console.log(`OK  descripcion_norm poblada (${n} productos)`);
  }

  if (await indiceExiste('productos', 'ftx_desc_norm')) {
    console.log('INFO ftx_desc_norm ya existe');
  } else {
    await run('productos.ftx_desc_norm (FULLTEXT)',
      `ALTER TABLE productos ADD FULLTEXT INDEX ftx_desc_norm (descripcion_norm)`);
  }

  // ── F3.3 — clave de cuadro básico / gobierno ──────────────────────────────
  await run('productos.clave_cuadro_basico',
    `ALTER TABLE productos ADD COLUMN IF NOT EXISTS clave_cuadro_basico VARCHAR(30) NULL`);
  if (await indiceExiste('productos', 'idx_clave_cuadro_basico')) {
    console.log('INFO idx_clave_cuadro_basico ya existe');
  } else {
    await run('productos.idx_clave_cuadro_basico',
      `ALTER TABLE productos ADD INDEX idx_clave_cuadro_basico (clave_cuadro_basico)`);
  }

  // ── F3.2 — estado de vinculación por partida ──────────────────────────────
  await run('solicitudes_partidas.match_estado',
    `ALTER TABLE solicitudes_partidas ADD COLUMN IF NOT EXISTS match_estado
       ENUM('sin_vincular','sugerido','confirmado') NOT NULL DEFAULT 'sin_vincular'`);
  await run('solicitudes_partidas.match_score',
    `ALTER TABLE solicitudes_partidas ADD COLUMN IF NOT EXISTS match_score DECIMAL(4,3) NULL`);
  await run('solicitudes_partidas.match_origen',
    `ALTER TABLE solicitudes_partidas ADD COLUMN IF NOT EXISTS match_origen VARCHAR(20) NULL`);

  // Backfill: las partidas que ya tienen producto_id quedan como 'confirmado'
  await run('backfill match_estado de partidas ya vinculadas',
    `UPDATE solicitudes_partidas
       SET match_estado = 'confirmado'
     WHERE producto_id IS NOT NULL AND match_estado = 'sin_vincular'`);

  // ── F4.2 — código del proveedor en la OC ──────────────────────────────────
  await run('ordenes_compra_partidas.sku_proveedor',
    `ALTER TABLE ordenes_compra_partidas ADD COLUMN IF NOT EXISTS sku_proveedor VARCHAR(60) NULL`);

  // ── Vista del comparador: exponer estado de vinculación ───────────────────
  await run('v_comparador_precios (+ match_estado/match_score)', `
    CREATE OR REPLACE VIEW v_comparador_precios AS
    SELECT
      s.id                                   AS solicitud_id,
      s.folio                                AS folio_solicitud,
      sp.id                                  AS partida_id,
      sp.linea,
      sp.descripcion_original,
      sp.codigo_cliente,
      sp.producto_id,
      sp.match_estado,
      sp.match_score,
      pr.sku_interno,
      pr.descripcion                         AS descripcion_interna,
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
    LEFT JOIN productos pr
      ON pr.id = sp.producto_id
    JOIN cotizaciones_proveedor cp
      ON cp.solicitud_id = s.id
    JOIN proveedores p
      ON p.id = cp.proveedor_id
    LEFT JOIN cotizaciones_proveedor_precios cpp
      ON  cpp.cotizacion_proveedor_id = cp.id
      AND cpp.partida_id = sp.id
    ORDER BY s.id, sp.linea, cpp.precio_unitario
  `);

  console.log('\nMigración v9 terminada.');
  process.exit(0);
})();
