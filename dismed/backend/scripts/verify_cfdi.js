/**
 * verify_cfdi.js — Verificación SOLO LECTURA del despliegue CFDI a través del túnel.
 * Uso: node scripts/verify_cfdi.js   (requiere túnel 127.0.0.1:3307 abierto)
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: parseInt(process.env.DB_PORT_TUNEL) || 3307,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'dismed_db', connectTimeout: 8000,
  });
  const q = async (s, p) => { const [r] = await c.query(s, p); return r; };

  console.log('== Tablas cfdi_* ==');
  const t = await q("SHOW TABLES LIKE 'cfdi\\_%'");
  console.log(t.map((x) => Object.values(x)[0]).join(', ') || '(ninguna)');

  console.log('\n== cfdi_repositorio por tipo/origen ==');
  console.table(await q(
    'SELECT tipo, origen, COUNT(*) n, MIN(fecha) AS desde, MAX(fecha) AS hasta FROM cfdi_repositorio GROUP BY tipo, origen ORDER BY tipo, origen'));

  const [{ conceptos }] = await q('SELECT COUNT(*) AS conceptos FROM cfdi_repositorio_conceptos');
  console.log('conceptos totales:', conceptos);

  console.log('\n== bitacora cfdi_descargas (ult. 10) ==');
  console.table(await q(
    'SELECT id, tipo, fecha_desde, fecha_hasta, estado, num_cfdis, num_importados, origen FROM cfdi_descargas ORDER BY id DESC LIMIT 10'));

  console.log('\n== muestra encabezado-detalle (1 comprobante con conceptos) ==');
  const [h] = await q('SELECT c.id, c.uuid, c.tipo, c.serie, c.folio, c.fecha, c.rfc_emisor, c.nombre_emisor, c.total FROM cfdi_repositorio c JOIN cfdi_repositorio_conceptos cc ON cc.comprobante_id = c.id GROUP BY c.id LIMIT 1');
  if (h) {
    console.log('ENCABEZADO:', JSON.stringify(h));
    console.table(await q('SELECT linea, clave_prod_serv, descripcion, cantidad, valor_unitario, importe FROM cfdi_repositorio_conceptos WHERE comprobante_id = ? ORDER BY linea LIMIT 5', [h.id]));
  } else {
    console.log('(sin conceptos)');
  }

  await c.end();
  process.exit(0);
})().catch((e) => { console.log('FAIL:', e.code || '', e.message); process.exit(1); });
