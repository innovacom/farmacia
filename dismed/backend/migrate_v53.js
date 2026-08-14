/**
 * Migración v53 — node migrate_v53.js
 * Pedido automático diario a Nadro (proveedor): cada noche el cron arma un
 * pedido con lo vendido en el día de los productos cuyo proveedor confirmado
 * en el catálogo (proveedores_catalogo) es Nadro, y lo coloca vía el portal
 * i22.nadro.mx (Puppeteer) usando NADRO_USUARIO/NADRO_PASSWORD del .env
 * (ver nadro.automation.service.js). nadro_pedidos_log es la bitácora de cada
 * corrida — también sirve para no correr dos veces el mismo día
 * (UNIQUE empresa_id+fecha).
 *
 * Idempotente: CREATE TABLE envuelto en run() (error -> INFO, ya existe).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE nadro_pedidos_log', `
    CREATE TABLE IF NOT EXISTS nadro_pedidos_log (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id   INT UNSIGNED NOT NULL,
      fecha        DATE         NOT NULL,
      estado       ENUM('ok','error','sin_items') NOT NULL,
      items_json   JSON         NULL COMMENT 'EAN, cantidad y estado de validación de cada línea enviada',
      total        DECIMAL(12,2) NULL COMMENT 'Total del pedido confirmado en Nadro, si aplica',
      orden_referencia VARCHAR(60) NULL COMMENT 'Referencia visible en la URL de confirmación de Nadro',
      mensaje      VARCHAR(500) NULL COMMENT 'Detalle de error, o resumen si fue exitoso',
      creado_en    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_nadro_pedido_dia (empresa_id, fecha),
      CONSTRAINT fk_nadro_pedido_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v53 terminada.');
  process.exit(0);
})();
