/**
 * Migración v45 — node migrate_v45.js
 * Precio editable en el mostrador (pos.ventas.service.js#crearVenta): el
 * cajero puede capturar un precio distinto al de catálogo por cualquier
 * situación (producto dañado, negociación, error de etiqueta, etc.), sin
 * autorización de supervisor, pero queda registrado — mismo principio de
 * "Preserve Original Data" del proyecto: se snapshotea el precio original y
 * el motivo en la propia partida, en vez de una tabla de bitácora aparte.
 * `precio_original`/`motivo_cambio_precio` NULL = la partida se vendió al
 * precio de lista, sin modificación. Reporte en
 * pos.reportes.service.js#preciosModificados (permiso pos-reportes-ganancias).
 *
 * Idempotente: cada ALTER envuelto en run() (error -> INFO); MariaDB no
 * soporta ADD COLUMN IF NOT EXISTS de forma confiable en esta versión.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('ADD pos_ventas_partidas.precio_original', `
    ALTER TABLE pos_ventas_partidas
      ADD COLUMN precio_original DECIMAL(12,2) NULL
        COMMENT 'precio de catálogo/presentación al momento de la venta, solo si el cajero lo modificó'
      AFTER precio_unitario`);

  await run('ADD pos_ventas_partidas.motivo_cambio_precio', `
    ALTER TABLE pos_ventas_partidas
      ADD COLUMN motivo_cambio_precio VARCHAR(255) NULL
        COMMENT 'motivo capturado por el cajero; NULL = no se modificó el precio de lista'
      AFTER precio_original`);

  console.log('\nMigración v45 terminada.');
  process.exit(0);
})();
