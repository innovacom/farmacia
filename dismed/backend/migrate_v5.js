/**
 * Migración v5 — node migrate_v5.js
 * INVENTARIO Entrega 1 — Catálogo + catálogos de apoyo.
 *
 *   · Tablas de apoyo: familias, categorias_prod, subcategorias_prod, unidades_medida
 *   · Extiende productos: bandera de control de lote, unidad base/factor, FKs de
 *     taxonomía, precios y atributos.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
 * El sku_interno = código INNOVACOM (INxxnnnnn).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  // ── Tablas de apoyo (taxonomía jerárquica) ───────────────────────────────
  await run('familias', `
    CREATE TABLE IF NOT EXISTS familias (
      id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(60)  NOT NULL,
      activo TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_familia (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('categorias_prod', `
    CREATE TABLE IF NOT EXISTS categorias_prod (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      familia_id INT UNSIGNED NOT NULL,
      nombre     VARCHAR(80)  NOT NULL,
      activo     TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_fam_cat (familia_id, nombre),
      CONSTRAINT fk_cat_familia FOREIGN KEY (familia_id)
        REFERENCES familias(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('subcategorias_prod', `
    CREATE TABLE IF NOT EXISTS subcategorias_prod (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      categoria_id INT UNSIGNED NOT NULL,
      nombre       VARCHAR(120) NOT NULL,
      activo       TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_cat_sub (categoria_id, nombre),
      CONSTRAINT fk_sub_categoria FOREIGN KEY (categoria_id)
        REFERENCES categorias_prod(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await run('unidades_medida', `
    CREATE TABLE IF NOT EXISTS unidades_medida (
      id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nombre          VARCHAR(40)  NOT NULL,
      factor_sugerido DECIMAL(10,2) NULL,
      activo          TINYINT(1)   NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_unidad (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // ── Extender productos ────────────────────────────────────────────────────
  // sku_interno ya existe VARCHAR(20) → alberga el código INNOVACOM.
  const cols = [
    ['control_lote_caducidad', "TINYINT(1) NOT NULL DEFAULT 1"],
    ['unidad_base',            "ENUM('pieza','empaque') NOT NULL DEFAULT 'pieza'"],
    ['factor_empaque',         "DECIMAL(10,2) NOT NULL DEFAULT 1"],
    ['familia_id',             "INT UNSIGNED NULL"],
    ['categoria_id',           "INT UNSIGNED NULL"],
    ['subcategoria_id',        "INT UNSIGNED NULL"],
    ['unidad_medida_id',       "INT UNSIGNED NULL"],
    ['precio_lista',           "DECIMAL(12,2) NULL"],
    ['precio_publico',         "DECIMAL(12,2) NULL"],
    ['fabricante',             "VARCHAR(120) NULL"],
    ['ean',                    "VARCHAR(20) NULL"],
    ['ieps',                   "DECIMAL(6,4) NULL"],
    ['sustancia_activa',       "VARCHAR(200) NULL"],
    ['tamano',                 "VARCHAR(60) NULL"],
    ['calibre',                "VARCHAR(60) NULL"],
    ['especificacion',         "VARCHAR(300) NULL"],
  ];
  for (const [name, def] of cols) {
    await run(`productos.${name}`,
      `ALTER TABLE productos ADD COLUMN IF NOT EXISTS ${name} ${def}`);
  }

  // FKs de taxonomía (idempotencia best-effort: si ya existen, MariaDB lanza error y se ignora)
  const fks = [
    ['fk_prod_familia',      'familia_id',      'familias(id)'],
    ['fk_prod_categoria',    'categoria_id',    'categorias_prod(id)'],
    ['fk_prod_subcategoria', 'subcategoria_id', 'subcategorias_prod(id)'],
    ['fk_prod_unidad',       'unidad_medida_id','unidades_medida(id)'],
  ];
  for (const [name, col, ref] of fks) {
    const [[exists]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'productos' AND CONSTRAINT_NAME = ?`,
      [name]
    );
    if (exists.n > 0) { console.log('INFO ' + name + ' ya existe'); continue; }
    await run(name,
      `ALTER TABLE productos ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ${ref} ON UPDATE CASCADE`);
  }

  console.log('\nMigración v5 terminada.');
  process.exit(0);
})();
