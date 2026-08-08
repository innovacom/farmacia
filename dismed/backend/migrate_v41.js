/**
 * Migración v41 — node migrate_v41.js
 * Integración con WhatsApp Cloud API (Meta) usando un número dedicado que
 * nunca tuvo WhatsApp (no requiere Coexistence). Ver
 * src/modules/whatsapp/README.md para la puesta en marcha (requiere
 * credenciales de Meta que aún no existen — este cambio solo deja lista la
 * base de datos).
 *
 * whatsapp_mensajes: registra cada recordatorio de cita enviado por la API
 * (wa_message_id) para poder ligar la respuesta del paciente (el webhook
 * manda context.id = wa_message_id del mensaje original) de vuelta a la cita.
 *
 * whatsapp_eventos: bitácora cruda de cualquier evento del webhook que no se
 * pudo ligar a un mensaje conocido (ej. texto libre del paciente en vez de
 * un botón), para revisar manualmente si hace falta.
 *
 * pos_citas +reprogramar_solicitado: el paciente pidió reprogramar por
 * WhatsApp (no se reagenda solo, requiere que el empleado lo contacte).
 *
 * Idempotente: CREATE TABLE / ADD COLUMN envueltos en run() (error -> INFO).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('CREATE whatsapp_mensajes', `
    CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
      id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id     INT UNSIGNED NOT NULL,
      cita_id        INT UNSIGNED NULL,
      tipo           VARCHAR(40) NOT NULL DEFAULT 'recordatorio_cita',
      telefono       VARCHAR(30) NOT NULL,
      wa_message_id  VARCHAR(64) NULL,
      estatus        ENUM('enviado','entregado','leido','fallo') NOT NULL DEFAULT 'enviado',
      respuesta_payload VARCHAR(60) NULL COMMENT 'ej. CITA_CONFIRMAR/CITA_REPROGRAMAR/CITA_CANCELAR',
      respuesta_en   DATETIME NULL,
      enviado_por    INT UNSIGNED NULL COMMENT 'NULL = disparado automático, no un clic de empleado',
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_wa_message_id (wa_message_id),
      KEY idx_wa_cita (cita_id),
      CONSTRAINT fk_wa_msg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_wa_msg_cita FOREIGN KEY (cita_id) REFERENCES pos_citas(id),
      CONSTRAINT fk_wa_msg_usuario FOREIGN KEY (enviado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE whatsapp_eventos', `
    CREATE TABLE IF NOT EXISTS whatsapp_eventos (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      tipo         VARCHAR(40) NOT NULL COMMENT 'ej. mensaje_no_ligado, smb_message_echo, estatus_desconocido',
      payload_json LONGTEXT NOT NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('pos_citas +reprogramar_solicitado', `
    ALTER TABLE pos_citas ADD COLUMN reprogramar_solicitado TINYINT(1) NOT NULL DEFAULT 0
      COMMENT 'el paciente pidió reprogramar vía WhatsApp; requiere que el empleado lo contacte' AFTER confirmada_por`);
  await run('pos_citas +reprogramar_solicitado_en', `
    ALTER TABLE pos_citas ADD COLUMN reprogramar_solicitado_en DATETIME NULL AFTER reprogramar_solicitado`);

  console.log('\nMigración v41 terminada.');
  process.exit(0);
})();
