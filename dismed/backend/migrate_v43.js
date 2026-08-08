/**
 * Migración v43 — node migrate_v43.js
 * Datos de horario para que el chatbot de WhatsApp (whatsapp.chatbot.service.js)
 * pueda contestar "¿están abiertos?" y "¿qué doctor está en turno?" con datos
 * reales en vez de inventar una respuesta. No toca pos_citas ni el flujo de
 * citas ya probado en producción: es solo información de consulta.
 *
 * dia_semana: 1=lunes .. 7=domingo (ISO), para que coincida con
 * WEEKDAY(NOW())+1 en MySQL (NOW() ya está en tz -06:00 por config/db.js).
 *
 * Varias filas por entidad/día son válidas (ej. un médico con turno matutino
 * y vespertino el mismo día) — no hay UNIQUE por (entidad, dia_semana).
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS envuelto en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE sucursal_horarios', `
    CREATE TABLE IF NOT EXISTS sucursal_horarios (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id  INT UNSIGNED NOT NULL,
      sucursal_id INT UNSIGNED NOT NULL,
      dia_semana  TINYINT UNSIGNED NOT NULL COMMENT '1=lunes..7=domingo',
      hora_inicio TIME NULL,
      hora_fin    TIME NULL,
      cerrado     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = no abre ese día (hora_inicio/fin se ignoran)',
      PRIMARY KEY (id),
      KEY idx_horario_sucursal (sucursal_id, dia_semana),
      CONSTRAINT fk_horario_suc_empresa   FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_horario_suc_sucursal  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE medico_horarios', `
    CREATE TABLE IF NOT EXISTS medico_horarios (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id  INT UNSIGNED NOT NULL,
      medico_id   INT UNSIGNED NOT NULL,
      dia_semana  TINYINT UNSIGNED NOT NULL COMMENT '1=lunes..7=domingo',
      hora_inicio TIME NOT NULL,
      hora_fin    TIME NOT NULL,
      PRIMARY KEY (id),
      KEY idx_horario_medico (medico_id, dia_semana),
      CONSTRAINT fk_horario_med_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_horario_med_medico  FOREIGN KEY (medico_id) REFERENCES medicos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v43 terminada.');
  process.exit(0);
})();
