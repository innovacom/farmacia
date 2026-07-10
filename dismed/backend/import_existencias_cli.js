/**
 * Importador CLI de existencias — node import_existencias_cli.js <ruta.xlsx> "<Nombre Almacén>" <COD>
 * Crea/encuentra el almacén, crea ubicaciones desde TARIMA y registra una ENTRADA por renglón.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');
const { parseExistencias } = require('./src/modules/inventario/import.existencias');
const svc = require('./src/modules/inventario/movimientos.service');

(async () => {
  const file = process.argv[2];
  const nombreAlm = process.argv[3] || 'Bodega Refinería';
  const codAlm = process.argv[4] || 'BOD-REF';
  if (!file) { console.error('Uso: node import_existencias_cli.js <ruta.xlsx> [nombre] [codigo]'); process.exit(1); }

  const { renglones, resumen } = parseExistencias(file);
  console.log('Parseado:', JSON.stringify(resumen));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Almacén
    let [[alm]] = await conn.query('SELECT id FROM almacenes WHERE codigo = ?', [codAlm]);
    if (!alm) {
      const [r] = await conn.query('INSERT INTO almacenes (codigo, nombre) VALUES (?, ?)', [codAlm, nombreAlm]);
      alm = { id: r.insertId };
    }
    const almacenId = alm.id;

    const ubicCache = {};
    async function ubicacionId(codigo) {
      const cod = (codigo || 'SIN UBICACION').toString().trim().substring(0, 40);
      if (ubicCache[cod]) return ubicCache[cod];
      const [[u]] = await conn.query('SELECT id FROM ubicaciones WHERE almacen_id = ? AND codigo = ?', [almacenId, cod]);
      if (u) { ubicCache[cod] = u.id; return u.id; }
      const tipo = /anaquel/i.test(cod) ? 'anaquel' : (/^\d+$/.test(cod) ? 'tarima' : 'otro');
      const [r] = await conn.query('INSERT INTO ubicaciones (almacen_id, codigo, tipo) VALUES (?, ?, ?)', [almacenId, cod, tipo]);
      ubicCache[cod] = r.insertId;
      return r.insertId;
    }

    let importados = 0, omitidos = 0;
    const sinCat = [];
    for (const r of renglones) {
      const [[prod]] = await conn.query('SELECT id FROM productos WHERE sku_interno = ?', [r.sku_interno]);
      if (!prod) { omitidos++; if (sinCat.length < 40) sinCat.push(r.sku_interno); continue; }
      if (!(parseFloat(r.cantidad) > 0)) { omitidos++; continue; }
      const ubId = await ubicacionId(r.ubicacion);
      await svc.registrarEntrada(conn, {
        producto_id: prod.id, almacen_id: almacenId, ubicacion_id: ubId,
        cantidad: r.cantidad, costo_unitario: r.costo_unitario || 0,
        numero_lote: r.numero_lote, fecha_caducidad: r.fecha_caducidad,
        motivo: 'Carga inicial de inventario', referencia: 'IMPORT', permitir_sin_lote: true,
      });
      importados++;
    }
    await conn.commit();
    console.log(`\nImportación OK — almacén "${nombreAlm}" (#${almacenId}), importados=${importados}, omitidos=${omitidos}`);
    if (sinCat.length) console.log('SKU sin catálogo (omitidos):', sinCat.join(', '));
  } catch (e) {
    await conn.rollback();
    console.error('ERROR:', e.message);
  } finally {
    conn.release();
    process.exit(0);
  }
})();
