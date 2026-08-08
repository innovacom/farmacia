/**
 * Migración v42 — node migrate_v42.js
 * Expande la integración de WhatsApp (hasta ahora solo recordatorios de citas)
 * a una bandeja de mensajería general: recibir/enviar/guardar mensajes con
 * cualquier contacto, y envío masivo con plantilla aprobada (promociones).
 *
 * whatsapp_contactos: libreta de contactos que se alimenta sola (cualquier
 * mensaje entrante crea/actualiza su contacto) y también editable a mano.
 * telefono_normalizado (últimos 10 dígitos) es la llave de dedupe real: los
 * números mexicanos llegan de Meta con un "1" extra que el envío no agrega
 * (ver whatsapp.service.js#intentarReprogramarPorTexto de la v41), así que
 * comparar el string completo produce contactos duplicados.
 *
 * whatsapp_mensajes +contacto_id/direccion/contenido/leido: generaliza la
 * tabla (hasta ahora solo recordatorio_cita) para guardar CUALQUIER mensaje
 * de la bandeja, entrante o saliente, con su texto — no solo el estatus.
 *
 * whatsapp_campanas / whatsapp_campana_destinatarios: envío masivo con una
 * plantilla ya aprobada por Meta (fuera de la ventana de 24h un negocio solo
 * puede escribir con plantilla) a un grupo de contactos, con su progreso.
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
  await run('CREATE whatsapp_contactos', `
    CREATE TABLE IF NOT EXISTS whatsapp_contactos (
      id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id          INT UNSIGNED NOT NULL,
      telefono            VARCHAR(30) NOT NULL COMMENT 'tal cual se manda a la Graph API (wa_id o E.164)',
      telefono_normalizado CHAR(10) NOT NULL COMMENT 'últimos 10 dígitos, llave real de dedupe',
      nombre              VARCHAR(120) NULL,
      etiquetas           VARCHAR(255) NULL COMMENT 'lista separada por comas, para segmentar envíos masivos',
      notas               TEXT NULL,
      acepta_promociones  TINYINT(1) NOT NULL DEFAULT 1,
      primer_contacto_en  DATETIME NULL,
      ultimo_contacto_en  DATETIME NULL,
      creado_por          INT UNSIGNED NULL COMMENT 'NULL = se creó solo, a partir de un mensaje entrante',
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_wa_contacto_empresa_tel (empresa_id, telefono_normalizado),
      CONSTRAINT fk_wa_contacto_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_wa_contacto_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('whatsapp_mensajes +contacto_id', `
    ALTER TABLE whatsapp_mensajes ADD COLUMN contacto_id INT UNSIGNED NULL AFTER cita_id`);
  await run('whatsapp_mensajes +fk_contacto', `
    ALTER TABLE whatsapp_mensajes ADD CONSTRAINT fk_wa_msg_contacto FOREIGN KEY (contacto_id) REFERENCES whatsapp_contactos(id)`);
  await run('whatsapp_mensajes +idx_contacto', `
    ALTER TABLE whatsapp_mensajes ADD KEY idx_wa_msg_contacto (contacto_id)`);
  await run('whatsapp_mensajes +direccion', `
    ALTER TABLE whatsapp_mensajes ADD COLUMN direccion ENUM('entrante','saliente') NOT NULL DEFAULT 'saliente' AFTER tipo`);
  await run('whatsapp_mensajes +contenido', `
    ALTER TABLE whatsapp_mensajes ADD COLUMN contenido TEXT NULL COMMENT 'texto del mensaje (libre o de plantilla ya renderizado)' AFTER telefono`);
  await run('whatsapp_mensajes +leido', `
    ALTER TABLE whatsapp_mensajes ADD COLUMN leido TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = entrante sin revisar en la bandeja' AFTER estatus`);

  await run('CREATE whatsapp_campanas', `
    CREATE TABLE IF NOT EXISTS whatsapp_campanas (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id           INT UNSIGNED NOT NULL,
      nombre               VARCHAR(150) NOT NULL,
      template_name        VARCHAR(120) NOT NULL,
      template_lang        VARCHAR(10) NOT NULL DEFAULT 'es_MX',
      variable_valor       VARCHAR(255) NULL COMMENT 'texto fijo para la única variable de la plantilla (si no se personaliza por contacto)',
      personalizar_nombre  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = la variable se llena con whatsapp_contactos.nombre de cada destinatario',
      filtro_etiqueta      VARCHAR(100) NULL,
      total_destinatarios  INT UNSIGNED NOT NULL DEFAULT 0,
      enviados             INT UNSIGNED NOT NULL DEFAULT 0,
      fallidos             INT UNSIGNED NOT NULL DEFAULT 0,
      estatus              ENUM('borrador','enviando','completada','cancelada') NOT NULL DEFAULT 'borrador',
      creado_por           INT UNSIGNED NULL,
      created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      terminado_en         DATETIME NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_wa_camp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_wa_camp_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await run('CREATE whatsapp_campana_destinatarios', `
    CREATE TABLE IF NOT EXISTS whatsapp_campana_destinatarios (
      id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
      campana_id     INT UNSIGNED NOT NULL,
      contacto_id    INT UNSIGNED NOT NULL,
      estatus        ENUM('pendiente','enviado','fallo') NOT NULL DEFAULT 'pendiente',
      wa_message_id  VARCHAR(64) NULL,
      error          VARCHAR(255) NULL,
      enviado_en     DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_wa_camp_dest_campana (campana_id),
      CONSTRAINT fk_wa_camp_dest_campana FOREIGN KEY (campana_id) REFERENCES whatsapp_campanas(id),
      CONSTRAINT fk_wa_camp_dest_contacto FOREIGN KEY (contacto_id) REFERENCES whatsapp_contactos(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v42 terminada.');
  process.exit(0);
})();
