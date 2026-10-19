/**
 * Migración v78 — node migrate_v78.js
 * Reserva de mercancía por pedido + confirmación/cancelación de entregas:
 *  - pedidos_cliente_partidas.cantidad_reservada: piezas del inventario apartadas para esa partida
 *    (vivas = aún no entregadas). El stock libre de un producto = existencia − Σ reservas.
 *  - entregas.estatus: 'pendiente' (sugerida, NO descuenta inventario) → 'confirmada' (descuenta FEFO)
 *    | 'cancelada'. Las entregas existentes quedan 'confirmada'.
 *  - entregas_cancelaciones: bitácora de cancelaciones (parciales o totales) con motivo.
 * Idempotente.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  const [[ya]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos_cliente_partidas' AND COLUMN_NAME = 'cantidad_reservada'`);
  await run('pedidos_cliente_partidas.cantidad_reservada',
    "ALTER TABLE pedidos_cliente_partidas ADD COLUMN IF NOT EXISTS cantidad_reservada DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Piezas de inventario apartadas (aún no entregadas)' AFTER cantidad_entregada");
  if (!ya.n) {
    // Primera vez: lo ya recibido de proveedores y aún no entregado queda reservado para su pedido
    // (mismo comportamiento que antes de existir reservas).
    await run('backfill reservas (recibido − entregado)',
      `UPDATE pedidos_cliente_partidas
          SET cantidad_reservada = LEAST(cantidad_asignada - cantidad_entregada, GREATEST(0, cantidad_recibida - cantidad_entregada))
        WHERE producto_id IS NOT NULL AND cantidad_recibida > cantidad_entregada`);
  }
  await run('entregas.estatus',
    "ALTER TABLE entregas ADD COLUMN IF NOT EXISTS estatus ENUM('pendiente','confirmada','cancelada') NOT NULL DEFAULT 'confirmada' COMMENT 'pendiente = sugerida, no descuenta inventario'");
  await run('entregas.confirmada_at', 'ALTER TABLE entregas ADD COLUMN IF NOT EXISTS confirmada_at DATETIME NULL');
  await run('entregas.confirmada_por', 'ALTER TABLE entregas ADD COLUMN IF NOT EXISTS confirmada_por INT UNSIGNED NULL');
  await run('entregas.cancelada_at', 'ALTER TABLE entregas ADD COLUMN IF NOT EXISTS cancelada_at DATETIME NULL');
  await run('entregas.cancelada_por', 'ALTER TABLE entregas ADD COLUMN IF NOT EXISTS cancelada_por INT UNSIGNED NULL');
  await run('entregas.motivo_cancelacion', 'ALTER TABLE entregas ADD COLUMN IF NOT EXISTS motivo_cancelacion VARCHAR(300) NULL');
  await run('idx entregas.estatus', 'ALTER TABLE entregas ADD INDEX idx_ent_estatus (estatus)');
  await run('entregas_cancelaciones', `
    CREATE TABLE IF NOT EXISTS entregas_cancelaciones (
      id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entrega_id         INT UNSIGNED NOT NULL,
      entrega_partida_id INT UNSIGNED NULL,
      pedido_partida_id  INT UNSIGNED NULL,
      sku_interno        VARCHAR(20) NULL,
      cantidad           DECIMAL(10,2) NOT NULL COMMENT 'Piezas canceladas',
      total_entrega      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 si esta cancelación cerró la entrega completa',
      motivo             VARCHAR(300) NOT NULL,
      usuario_id         INT UNSIGNED NULL,
      created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_entc_ent (entrega_id),
      CONSTRAINT fk_entc_ent FOREIGN KEY (entrega_id) REFERENCES entregas(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.end();
})();
