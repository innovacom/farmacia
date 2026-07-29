/**
 * Migración v37 — node migrate_v37.js
 * Agenda de citas médicas del POS Farmacia: no importa qué médico esté de
 * guardia, solo se aparta el horario y el nombre del paciente. Cuando el
 * paciente se presenta a pagar (a veces antes de la cita) se hace la venta
 * normal de mostrador y se liga aquí (pos_citas.venta_id) para marcarla
 * pagada — no hay flujo de cobro propio, reusa pos_ventas.
 *
 * Duración fija de 30 min por cita (no se expone en el UI, pero queda en
 * columna aparte por si se necesita variar a futuro). Horario válido
 * (lunes a sábado, 10:00-20:00) se valida en el servicio, no en la BD.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS envuelto en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE pos_citas', `
    CREATE TABLE IF NOT EXISTS pos_citas (
      id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id         INT UNSIGNED NOT NULL,
      sucursal_id        INT UNSIGNED NOT NULL,
      fecha              DATE NOT NULL,
      hora_inicio        TIME NOT NULL,
      duracion_min       SMALLINT UNSIGNED NOT NULL DEFAULT 30,
      paciente_nombre    VARCHAR(150) NOT NULL,
      paciente_telefono  VARCHAR(30)  NULL,
      notas              VARCHAR(300) NULL,
      estatus            ENUM('agendada','atendida','cancelada') NOT NULL DEFAULT 'agendada',
      venta_id           INT UNSIGNED NULL COMMENT 'se liga al cobrar (pos_ventas.id)',
      pagada             TINYINT(1) NOT NULL DEFAULT 0,
      pagada_en          DATETIME NULL,
      cancelada_en       DATETIME NULL,
      cancelada_por      INT UNSIGNED NULL,
      motivo_cancelacion VARCHAR(200) NULL,
      creado_por         INT UNSIGNED NOT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cita_sucursal_fecha (sucursal_id, fecha, hora_inicio),
      CONSTRAINT fk_cita_empresa   FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_cita_sucursal  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
      CONSTRAINT fk_cita_venta     FOREIGN KEY (venta_id) REFERENCES pos_ventas(id),
      CONSTRAINT fk_cita_creador   FOREIGN KEY (creado_por) REFERENCES usuarios(id),
      CONSTRAINT fk_cita_cancela   FOREIGN KEY (cancelada_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v37 terminada.');
  process.exit(0);
})();
