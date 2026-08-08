/**
 * Migración v44 — node migrate_v44.js
 * Preguntas frecuentes del chatbot de WhatsApp (whatsapp.chatbot.service.js)
 * dejan de estar hardcodeadas en código (objeto FAQS) y pasan a la tabla
 * whatsapp_faqs, editable por el admin desde Configuración → WhatsApp →
 * Preguntas frecuentes (whatsapp.faqs.controller.js). El clasificador de
 * intención del chatbot arma su prompt dinámicamente con las filas activas.
 *
 * Idempotente: CREATE TABLE envuelto en run() (error -> INFO). El seed de
 * las 5 preguntas originales solo se inserta si la empresa todavía no tiene
 * ninguna fila, para no duplicar en una segunda corrida ni pisar lo que un
 * admin ya haya editado.
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

const SEED = [
  {
    pregunta: 'Pregunta si hay servicio a domicilio para la entrega de productos/pedidos, o el costo del envío.',
    respuesta: 'Sí, tenemos servicio a domicilio. En compras mayores a $120.00 pesos la entrega dentro del área de cobertura es gratis; en compras menores tiene un costo de $15.00 pesos.',
  },
  {
    pregunta: 'Pregunta si el médico da consulta a domicilio, o el costo de la consulta médica a domicilio.',
    respuesta: 'Sí, hay citas médicas a domicilio con un costo de $120.00. Además, el paciente debe pagar el traslado de ida y vuelta del doctor. Las medicinas que se receten no están incluidas en ese costo.',
  },
  {
    pregunta: 'Pregunta por el área o zona de cobertura de la entrega a domicilio o de la consulta médica a domicilio.',
    respuesta: 'El área de cobertura, tanto para entrega a domicilio como para consulta médica a domicilio, es de dos kilómetros a la redonda de la dirección de la farmacia.',
  },
  {
    pregunta: 'Pregunta si venden medicamentos controlados.',
    respuesta: 'No, no vendemos medicamentos controlados.',
  },
  {
    pregunta: 'Pregunta si venden antibióticos o si necesita receta para comprarlos.',
    respuesta: 'Sí vendemos antibióticos. Recuerda que es necesario presentar la receta médica para poder realizar la compra de este tipo de medicamentos.',
  },
];

(async () => {
  await run('CREATE whatsapp_faqs', `
    CREATE TABLE IF NOT EXISTS whatsapp_faqs (
      id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
      empresa_id  INT UNSIGNED NOT NULL,
      pregunta    VARCHAR(255) NOT NULL COMMENT 'describe cuándo aplica esta FAQ; arma el prompt del clasificador de intención',
      respuesta   TEXT NOT NULL,
      activo      TINYINT(1) NOT NULL DEFAULT 1,
      orden       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      creado_por  INT UNSIGNED NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wa_faq_empresa (empresa_id, activo, orden),
      CONSTRAINT fk_wa_faq_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      CONSTRAINT fk_wa_faq_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [empresas] = await pool.query('SELECT id FROM empresas');
  for (const { id: empresaId } of empresas) {
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM whatsapp_faqs WHERE empresa_id = ?', [empresaId]
    );
    if (total > 0) {
      console.log(`INFO seed whatsapp_faqs — empresa ${empresaId} ya tiene preguntas, se omite`);
      continue;
    }
    for (let i = 0; i < SEED.length; i++) {
      await pool.query(
        'INSERT INTO whatsapp_faqs (empresa_id, pregunta, respuesta, orden) VALUES (?, ?, ?, ?)',
        [empresaId, SEED[i].pregunta, SEED[i].respuesta, i + 1]
      );
    }
    console.log(`OK  seed whatsapp_faqs — empresa ${empresaId}: ${SEED.length} preguntas`);
  }

  console.log('\nMigración v44 terminada.');
  process.exit(0);
})();
