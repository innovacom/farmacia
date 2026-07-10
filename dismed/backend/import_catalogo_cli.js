/**
 * Importador CLI del catálogo maestro — node import_catalogo_cli.js <ruta.xlsx>
 * Reutiliza el parser de import.catalogo y hace el mismo upsert que importConfirm.
 * Idempotente (ON DUPLICATE KEY UPDATE por sku_interno).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');
const { parseCatalogo } = require('./src/modules/inventario/import.catalogo');

async function resolverId(conn, cache, tabla, whereCols, whereVals, insertCols, insertVals) {
  const key = tabla + '|' + whereVals.join('|');
  if (cache[key]) return cache[key];
  const wsql = whereCols.map((c) => `${c} = ?`).join(' AND ');
  const [[row]] = await conn.query(`SELECT id FROM ${tabla} WHERE ${wsql} LIMIT 1`, whereVals);
  if (row) { cache[key] = row.id; return row.id; }
  const [r] = await conn.query(
    `INSERT INTO ${tabla} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    insertVals
  );
  cache[key] = r.insertId;
  return r.insertId;
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node import_catalogo_cli.js <ruta.xlsx>'); process.exit(1); }

  const { productos, resumen } = parseCatalogo(file);
  console.log('Parseado:', JSON.stringify(resumen));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cache = {};
    let insertados = 0, actualizados = 0, omitidos = 0;
    const omit = [];

    let omitSinSat = 0;
    for (const p of productos) {
      const sku = (p.sku_interno || '').toString().trim();
      if (!sku || !p.descripcion || !p.familia || !p.categoria || !p.subcategoria
          || p.precio_lista == null || !p.unidad_medida) {
        omitidos++; if (omit.length < 30) omit.push(sku || '(sin sku)');
        continue;
      }
      // Regla CFDI: un producto sin clave SAT (codigo_sat) no se puede facturar → no se carga.
      if (!p.clave_sat) {
        omitidos++; omitSinSat++; if (omit.length < 30) omit.push(`${sku} (sin codigo_sat)`);
        continue;
      }
      const familiaId = await resolverId(conn, cache, 'familias',
        ['nombre'], [p.familia], ['nombre'], [p.familia]);
      const categoriaId = await resolverId(conn, cache, 'categorias_prod',
        ['familia_id', 'nombre'], [familiaId, p.categoria], ['familia_id', 'nombre'], [familiaId, p.categoria]);
      const subcatId = await resolverId(conn, cache, 'subcategorias_prod',
        ['categoria_id', 'nombre'], [categoriaId, p.subcategoria], ['categoria_id', 'nombre'], [categoriaId, p.subcategoria]);
      const unidadId = await resolverId(conn, cache, 'unidades_medida',
        ['nombre'], [p.unidad_medida], ['nombre', 'factor_sugerido'], [p.unidad_medida, p.factor_empaque ?? null]);

      const [r] = await conn.query(
        `INSERT INTO productos
           (sku_interno, descripcion, familia_id, categoria_id, subcategoria_id,
            unidad_medida, unidad_medida_id, unidad_base, factor_empaque,
            control_lote_caducidad, precio_lista, precio_publico, iva_exento, ieps,
            clave_sat, clave_unidad_sat, fabricante, ean,
            sustancia_activa, tamano, calibre, especificacion)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           descripcion=VALUES(descripcion), familia_id=VALUES(familia_id),
           categoria_id=VALUES(categoria_id), subcategoria_id=VALUES(subcategoria_id),
           unidad_medida=VALUES(unidad_medida), unidad_medida_id=VALUES(unidad_medida_id),
           factor_empaque=VALUES(factor_empaque), control_lote_caducidad=VALUES(control_lote_caducidad),
           precio_lista=VALUES(precio_lista), precio_publico=VALUES(precio_publico),
           iva_exento=VALUES(iva_exento), ieps=VALUES(ieps),
           clave_sat=VALUES(clave_sat), clave_unidad_sat=VALUES(clave_unidad_sat),
           fabricante=VALUES(fabricante), ean=VALUES(ean),
           sustancia_activa=VALUES(sustancia_activa), tamano=VALUES(tamano),
           calibre=VALUES(calibre), especificacion=VALUES(especificacion)`,
        [sku, p.descripcion, familiaId, categoriaId, subcatId,
         p.unidad_medida, unidadId, p.unidad_base || 'pieza', p.factor_empaque ?? 1,
         p.control_lote_caducidad ? 1 : 0,
         p.precio_lista, p.precio_publico ?? null, p.iva_exento ? 1 : 0, p.ieps ?? null,
         p.clave_sat || null, p.clave_unidad_sat || null, p.fabricante || null, p.ean || null,
         p.sustancia_activa || null, p.tamano || null, p.calibre || null, p.especificacion || null]
      );
      if (r.affectedRows === 1) insertados++; else actualizados++;
    }

    await conn.commit();
    console.log(`\nImportación OK — insertados=${insertados} actualizados=${actualizados} omitidos=${omitidos} (de ellos sin codigo_sat=${omitSinSat})`);
    if (resumen.skus_duplicados?.length) console.log('SKUs duplicados en archivo (último gana):', resumen.skus_duplicados.join(', '));
    if (omit.length) console.log('Omitidos (faltan obligatorias):', omit.join(', '));
  } catch (e) {
    await conn.rollback();
    console.error('ERROR:', e.message);
  } finally {
    conn.release();
    process.exit(0);
  }
})();
