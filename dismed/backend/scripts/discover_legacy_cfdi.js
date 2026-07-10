/**
 * discover_legacy_cfdi.js — Exploración (solo lectura) del sistema anterior
 * para localizar las tablas de CFDI emitidos/recibidos y su estructura.
 * Uso: node scripts/discover_legacy_cfdi.js
 */
const { createOldPool } = require('../src/config/old-db');

(async () => {
  const pool = createOldPool();
  try {
    const [tables] = await pool.query('SHOW TABLES');
    const key = Object.keys(tables[0])[0];
    const names = tables.map((t) => t[key]);
    const re = /(cfdi|factura|comprobante|emitid|recibid|xml|timbr|concepto|detalle_factura|repositorio)/i;
    const candidates = names.filter((n) => re.test(n));
    console.log('=== TODAS LAS TABLAS (' + names.length + ') ===');
    console.log(names.join('\n'));
    console.log('\n=== CANDIDATAS CFDI ===');
    console.log(candidates.join('\n') || '(ninguna por nombre)');

    for (const t of candidates) {
      console.log('\n\n########## TABLA: ' + t + ' ##########');
      const [cols] = await pool.query('SHOW COLUMNS FROM `' + t + '`');
      console.log('--- columnas ---');
      cols.forEach((c) => console.log(`  ${c.Field}  ${c.Type}  ${c.Null}  ${c.Key}`));
      const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM `' + t + '`');
      console.log('--- filas: ' + n);
      const [sample] = await pool.query('SELECT * FROM `' + t + '` LIMIT 1');
      if (sample[0]) {
        const trimmed = {};
        for (const [k, v] of Object.entries(sample[0])) {
          let s = v == null ? null : (Buffer.isBuffer(v) ? `<blob ${v.length}b>` : String(v));
          if (s && s.length > 120) s = s.slice(0, 120) + '…';
          trimmed[k] = s;
        }
        console.log('--- muestra ---');
        console.log(JSON.stringify(trimmed, null, 1));
      }
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
