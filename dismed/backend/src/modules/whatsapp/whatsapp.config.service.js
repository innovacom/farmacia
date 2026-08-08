/**
 * whatsapp.config.service.js — Configuración del módulo de WhatsApp editable
 * por el admin (por ahora: saludo_bienvenida, ver migrate_v49). Usado por
 * whatsapp.service.js#procesarMensajeEntrante para el primer mensaje de una
 * conversación nueva.
 */
const { pool } = require('../../config/db');

async function obtenerSaludo(empresaId) {
  const [[row]] = await pool.query(
    'SELECT saludo_bienvenida FROM whatsapp_config WHERE empresa_id = ?', [empresaId]
  );
  return row?.saludo_bienvenida || null;
}

async function actualizarSaludo(empresaId, saludo) {
  const texto = (saludo || '').trim() || null;
  await pool.query(
    `INSERT INTO whatsapp_config (empresa_id, saludo_bienvenida) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE saludo_bienvenida = VALUES(saludo_bienvenida)`,
    [empresaId, texto]
  );
  return { saludo_bienvenida: texto };
}

module.exports = { obtenerSaludo, actualizarSaludo };
