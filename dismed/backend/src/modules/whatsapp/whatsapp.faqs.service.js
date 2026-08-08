/**
 * whatsapp.faqs.service.js — preguntas frecuentes de negocio que contesta el
 * chatbot de WhatsApp (whatsapp.chatbot.service.js) con una respuesta fija.
 * Editables por el admin desde Configuración → WhatsApp → Preguntas
 * frecuentes, sin tocar código (ver migrate_v44).
 */
const { pool } = require('../../config/db');
const { badRequest } = require('./whatsapp.util');
const { getScoped: getScopedTenant } = require('../pos/pos.tenant.helpers');

async function getScoped(empresaId, id) {
  return getScopedTenant(pool, 'whatsapp_faqs', id, empresaId, { notFoundMsg: 'Pregunta no encontrada' });
}

async function listar(empresaId) {
  const [rows] = await pool.query(
    'SELECT * FROM whatsapp_faqs WHERE empresa_id = ? ORDER BY orden, id', [empresaId]
  );
  return rows;
}

// Valida y normaliza el payload de alta/edición — pregunta/respuesta
// requeridas, activo/orden con sus defaults.
function validarFaq({ pregunta, respuesta, activo, orden }) {
  if (!pregunta?.trim()) throw badRequest('La pregunta es requerida');
  if (!respuesta?.trim()) throw badRequest('La respuesta es requerida');
  return { pregunta: pregunta.trim(), respuesta: respuesta.trim(), activo: activo === false ? 0 : 1, orden: Number(orden) || 0 };
}

async function crear(empresaId, body, usuarioId) {
  const v = validarFaq(body);
  const [r] = await pool.query(
    `INSERT INTO whatsapp_faqs (empresa_id, pregunta, respuesta, activo, orden, creado_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empresaId, v.pregunta, v.respuesta, v.activo, v.orden, usuarioId]
  );
  return { id: r.insertId };
}

async function actualizar(empresaId, id, body) {
  await getScoped(empresaId, id);
  const v = validarFaq(body);
  await pool.query(
    `UPDATE whatsapp_faqs SET pregunta = ?, respuesta = ?, activo = ?, orden = ? WHERE id = ? AND empresa_id = ?`,
    [v.pregunta, v.respuesta, v.activo, v.orden, id, empresaId]
  );
  return { ok: true };
}

async function eliminar(empresaId, id) {
  await getScoped(empresaId, id);
  await pool.query('DELETE FROM whatsapp_faqs WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return { ok: true };
}

module.exports = { listar, crear, actualizar, eliminar };
