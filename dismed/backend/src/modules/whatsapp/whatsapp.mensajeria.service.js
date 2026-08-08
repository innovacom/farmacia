/**
 * whatsapp.mensajeria.service.js — bandeja general de WhatsApp (pantalla que
 * sustituye a tener WhatsApp abierto aparte): lista de conversaciones por
 * contacto, historial de mensajes, y enviar texto libre. Reusa
 * whatsapp_mensajes (ya lo alimenta también el flujo de citas) filtrando por
 * contacto_id en vez de cita_id.
 */
const { pool } = require('../../config/db');
const client = require('./whatsapp.client');
const contactos = require('./whatsapp.contactos.service');

// Una fila por contacto con su último mensaje y cuántos entrantes sin leer
// — lo que se ve en la lista de la izquierda de la bandeja.
async function listarConversaciones(empresaId, { q } = {}) {
  const params = [empresaId];
  let filtroContacto = '';
  if (q) {
    filtroContacto = ' AND (c.nombre LIKE ? OR c.telefono_normalizado LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const [rows] = await pool.query(
    `SELECT
       c.id AS contacto_id, c.nombre, c.telefono, c.telefono_normalizado, c.acepta_promociones,
       m.contenido AS ultimo_mensaje, m.direccion AS ultimo_direccion, m.created_at AS ultimo_en,
       (SELECT COUNT(*) FROM whatsapp_mensajes m2
          WHERE m2.contacto_id = c.id AND m2.direccion = 'entrante' AND m2.leido = 0) AS no_leidos
     FROM whatsapp_contactos c
     LEFT JOIN whatsapp_mensajes m ON m.id = (
       SELECT m3.id FROM whatsapp_mensajes m3 WHERE m3.contacto_id = c.id ORDER BY m3.created_at DESC, m3.id DESC LIMIT 1
     )
     WHERE c.empresa_id = ?${filtroContacto}
     ORDER BY (m.created_at IS NULL), m.created_at DESC, c.ultimo_contacto_en DESC`,
    params
  );
  return rows;
}

async function listarMensajes(empresaId, contactoId) {
  await contactos.getScopedContacto(empresaId, contactoId);
  const [rows] = await pool.query(
    `SELECT id, tipo, direccion, contenido, estatus, respuesta_payload, created_at
     FROM whatsapp_mensajes
     WHERE empresa_id = ? AND contacto_id = ?
     ORDER BY created_at, id`,
    [empresaId, contactoId]
  );
  return rows;
}

// Conversaciones cuyo último mensaje es entrante — nadie contestó todavía
// (ni el chatbot ni un empleado a mano). Es justo lo que necesita saber el
// mostrador: no importa POR QUÉ el bot no respondió (intención no
// reconocida, error, tipo de mensaje sin manejar, etc.) — si el último
// mensaje del contacto sigue sin respuesta, hay que atenderlo.
async function pendientesResponder(empresaId) {
  const [rows] = await pool.query(
    `SELECT c.id AS contacto_id, c.nombre, c.telefono, m.contenido AS ultimo_mensaje, m.created_at AS ultimo_en
     FROM whatsapp_contactos c
     JOIN whatsapp_mensajes m ON m.id = (
       SELECT m3.id FROM whatsapp_mensajes m3 WHERE m3.contacto_id = c.id ORDER BY m3.created_at DESC, m3.id DESC LIMIT 1
     )
     WHERE c.empresa_id = ? AND m.direccion = 'entrante'
     ORDER BY m.created_at ASC`,
    [empresaId]
  );
  return rows;
}

async function marcarLeido(empresaId, contactoId) {
  await contactos.getScopedContacto(empresaId, contactoId);
  await pool.query(
    `UPDATE whatsapp_mensajes SET leido = 1 WHERE empresa_id = ? AND contacto_id = ? AND direccion = 'entrante'`,
    [empresaId, contactoId]
  );
  return { ok: true };
}

// Texto libre: Meta solo lo permite dentro de la ventana de 24h desde el
// último mensaje del contacto (si no, hay que usar una plantilla — ver
// whatsapp.campanas.service para el envío masivo). Si Meta lo rechaza, el
// error sube tal cual para que la bandeja lo muestre (no se traga el fallo
// como sí hace whatsapp.service.js#enviarTexto, que es "mejor esfuerzo"
// para las respuestas automáticas del bot de citas).
async function enviarMensajeTexto(empresaId, contactoId, texto, usuarioId) {
  if (!texto?.trim()) throw Object.assign(new Error('Mensaje vacío'), { status: 400 });
  const contacto = await contactos.getScopedContacto(empresaId, contactoId);

  const waMessageId = await client.enviarTextoLibre({ telefonoE164: contacto.telefono, texto: texto.trim() });

  await contactos.registrarMensajeSaliente(empresaId, contacto.telefono, {
    tipo: 'texto_libre', contenido: texto.trim(), waMessageId, contactoId, enviadoPor: usuarioId,
  });
  await pool.query('UPDATE whatsapp_contactos SET ultimo_contacto_en = NOW() WHERE id = ?', [contactoId]);
  return { ok: true, wa_message_id: waMessageId };
}

module.exports = { listarConversaciones, listarMensajes, pendientesResponder, marcarLeido, enviarMensajeTexto };
