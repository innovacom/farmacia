/**
 * wipe_transaccional.js — Borra los datos TRANSACCIONALES de dismed_db para dejar
 * el sistema limpio antes de la importación histórica. NO toca catálogos
 * (productos, proveedores_catalogo, familias, etc.) ni usuarios (logins).
 *
 * Tablas que vacía: toda la cadena solicitud → cotización → pedido → OC →
 * entrega/recepción → factura/cobranza/pago, más movimientos/lotes de inventario.
 * Reinicia la tabla `folios`.
 *
 * SEGURIDAD: sin `--yes` solo muestra lo que haría (dry-run).
 *   node scripts/wipe_transaccional.js          # dry-run
 *   node scripts/wipe_transaccional.js --yes     # ejecuta
 *
 * Opcional: `--clientes` vacía también clientes y sus tablas hijas (úsalo solo si
 * los clientes actuales son de prueba; la importación recrea los clientes legacy).
 */
const { pool } = require('../src/config/db');

const CONFIRM = process.argv.includes('--yes');
const WIPE_CLIENTES = process.argv.includes('--clientes');

// Orden no importa: se desactiva FOREIGN_KEY_CHECKS durante el truncado.
const TABLES = [
  'cotizaciones_cliente_partidas', 'cotizaciones_cliente',
  'cotizaciones_proveedor_precios', 'cotizaciones_proveedor',
  'solicitudes_partidas', 'solicitudes',
  'pedidos_cliente_partidas', 'pedidos_cliente', 'pedidos',
  'ordenes_compra_partidas', 'ordenes_compra',
  'recepciones_partidas', 'recepciones',
  'entregas_partidas', 'entregas',
  'facturas', 'cobranza', 'pagos',
  'inventario_movimientos', 'inventario_lotes',
];
const TABLES_CLIENTES = ['clientes_skus', 'clientes_contactos', 'clientes'];

(async () => {
  const conn = await pool.getConnection();
  try {
    const list = WIPE_CLIENTES ? [...TABLES, ...TABLES_CLIENTES] : TABLES;

    console.log('Conteo actual:');
    for (const t of list) {
      try {
        const [[r]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
        console.log(`  ${t}: ${r.c}`);
      } catch (e) { console.log(`  ${t}: (no existe?) ${e.code}`); }
    }

    if (!CONFIRM) {
      console.log('\nDRY-RUN. Para ejecutar el borrado agrega --yes');
      return;
    }

    console.log('\nBorrando...');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of list) {
      try { await conn.query(`TRUNCATE TABLE \`${t}\``); console.log(`  truncado ${t}`); }
      catch (e) { console.log(`  ERROR ${t}: ${e.code}`); }
    }
    await conn.query('UPDATE folios SET ultimo = 0');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\nListo. Folios reiniciados.');
  } catch (e) {
    console.error('FALLO:', e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
})();
