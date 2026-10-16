/**
 * Migración v74 — node migrate_v74.js
 * Cobranza de clientes: cobros (abonos) aplicados a facturas.
 *
 *  - cobros                 (un pago recibido del cliente, opcionalmente de una sucursal)
 *  - cobros_aplicaciones    (cuánto de ese cobro se aplica a cada factura/entrega)
 *  - configuracion.credito_modo = 'aviso' | 'bloqueo'
 *      aviso   → al crear un pedido que rebasa el límite de crédito solo se advierte.
 *      bloqueo → se rechaza; un admin puede autorizar el pedido.
 *
 * Cuenta por cobrar = entregas tipo 'factura' no canceladas (estatus_cfdi <> 'cancelado').
 * Saldo de una factura = total − cobros activos aplicados. FKs INT UNSIGNED como clientes.id.
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('cobros', `
    CREATE TABLE IF NOT EXISTS cobros (
      id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      cliente_id   INT UNSIGNED  NOT NULL,
      sucursal_id  INT UNSIGNED  NULL,
      fecha        DATE          NOT NULL,
      monto        DECIMAL(14,2) NOT NULL,
      forma_pago   VARCHAR(30)   NOT NULL DEFAULT 'transferencia',
      referencia   VARCHAR(100)  NULL,
      notas        TEXT          NULL,
      estatus      ENUM('activo','cancelado') NOT NULL DEFAULT 'activo',
      usuario_id   INT UNSIGNED  NULL,
      cancelado_at TIMESTAMP     NULL,
      cancelado_por INT UNSIGNED NULL,
      created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cobros_cliente (cliente_id, estatus),
      KEY idx_cobros_sucursal (sucursal_id),
      CONSTRAINT fk_cobros_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON UPDATE CASCADE,
      CONSTRAINT fk_cobros_sucursal FOREIGN KEY (sucursal_id) REFERENCES clientes_sucursales(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await run('cobros_aplicaciones', `
    CREATE TABLE IF NOT EXISTS cobros_aplicaciones (
      id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      cobro_id   INT UNSIGNED  NOT NULL,
      entrega_id INT UNSIGNED  NOT NULL,
      monto      DECIMAL(14,2) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_cobapl_cobro (cobro_id),
      KEY idx_cobapl_entrega (entrega_id),
      CONSTRAINT fk_cobapl_cobro FOREIGN KEY (cobro_id) REFERENCES cobros(id) ON UPDATE CASCADE,
      CONSTRAINT fk_cobapl_entrega FOREIGN KEY (entrega_id) REFERENCES entregas(id) ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await run('seed credito_modo=aviso', `
    INSERT IGNORE INTO configuracion (clave, valor, descripcion)
    VALUES ('credito_modo', 'aviso',
            'Al rebasar el límite de crédito en un pedido: aviso (solo advierte) o bloqueo (requiere autorización de admin)')
  `);

  console.log('\nMigración v74 terminada.');
  process.exit(0);
})();
