/**
 * Migración v49 — node migrate_v49.js
 * Mensaje de bienvenida configurable para el primer mensaje de una
 * conversación de WhatsApp (o el primero después de varias horas sin
 * actividad — ver NUEVA_SESION_HORAS en whatsapp.service.js). Antes no
 * existía: un saludo ("hola", "buenas tardes", "disculpe"...) caía en la
 * intención "otro" del chatbot (whatsapp.chatbot.service.js) y no se
 * contestaba nada. Editable desde Configuración → WhatsApp → Preguntas
 * frecuentes (mismo permiso whatsapp-faqs) para poder cambiarlo cada cierto
 * tiempo sin tocar código; si el admin borra el texto, el saludo se
 * desactiva sin afectar las respuestas normales del chatbot.
 *
 * Idempotente: CREATE IF NOT EXISTS + INSERT IGNORE (no pisa lo que el admin
 * ya haya editado).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql, params = []) {
  try { await pool.query(sql, params); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

const DEFAULT_SALUDO = '¡Hola! Gracias por contactarnos. ¿En qué podemos ayudarte?';

(async () => {
  await run('whatsapp_config (tabla)', `
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      empresa_id        INT UNSIGNED NOT NULL,
      saludo_bienvenida TEXT NULL
                        COMMENT 'Se envía en el primer mensaje de una conversación nueva; NULL = desactivado',
      updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (empresa_id),
      CONSTRAINT fk_wa_config_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Configuración del módulo de WhatsApp editable por administradores'
  `);

  const [empresas] = await pool.query('SELECT id FROM empresas');
  for (const { id: empresaId } of empresas) {
    await run(`seed whatsapp_config — empresa ${empresaId}`, `
      INSERT IGNORE INTO whatsapp_config (empresa_id, saludo_bienvenida) VALUES (?, ?)
    `, [empresaId, DEFAULT_SALUDO]);
  }

  console.log('\nMigración v49 terminada.');
  process.exit(0);
})();
