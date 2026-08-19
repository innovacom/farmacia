/**
 * Migración v62 — node migrate_v62.js
 * Cuenta de cliente en la tienda web (Entrega 2). Acceso sin contraseña:
 * código de un solo uso enviado por WhatsApp (plantilla AUTHENTICATION
 * "autenticacion", id 2004297164308188, aprobada por Meta) — el backend no
 * tiene ningún servicio de correo (ver migrate_v61 y ARQUITECTURA.md, que
 * documentan SMTP pero nunca implementado), así que no hay forma de
 * recuperar una contraseña olvidada; el código reemplaza tanto el login
 * como el "olvidé mi contraseña".
 *
 * tienda_codigos_acceso: el código se guarda SIEMPRE hasheado con bcryptjs
 * (nunca en claro), vigente 10 minutos (mismo plazo que la plantilla le
 * anuncia al cliente: "Vence en 10 minutos"), máximo 5 intentos de
 * verificación por código. El tope de 3 códigos por teléfono cada 15 min
 * (aplicado en tienda.cuenta.service.js, no en esta tabla) importa además
 * del rate-limit por IP de la ruta: cada envío cuesta un mensaje de
 * WhatsApp y un tercero podría hostigar el teléfono de otra persona desde
 * IPs distintas.
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
  await run('CREATE tienda_codigos_acceso', `
    CREATE TABLE IF NOT EXISTS tienda_codigos_acceso (
      id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id            INT UNSIGNED NOT NULL,
      telefono_normalizado  CHAR(10) NOT NULL COMMENT 'últimos 10 dígitos, mismo criterio que pos_clientes_fidelidad',
      codigo_hash           VARCHAR(255) NOT NULL COMMENT 'bcrypt del código de 6 dígitos, nunca en claro',
      expira_en             DATETIME NOT NULL,
      intentos               TINYINT UNSIGNED NOT NULL DEFAULT 0,
      consumido_en          DATETIME NULL,
      ip                    VARCHAR(45) NULL COMMENT 'endpoint público sin auth: única pista para abuso',
      created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tca_empresa_tel_fecha (empresa_id, telefono_normalizado, created_at),
      CONSTRAINT fk_tca_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  console.log('\nMigración v62 terminada.');
  console.log('Requiere WHATSAPP_TEMPLATE_CODIGO=autenticacion (default) y WHATSAPP_TEMPLATE_CODIGO_LANG=es (default) en .env, más las credenciales de WhatsApp Cloud API ya existentes.');
  process.exit(0);
})();
