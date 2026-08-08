/**
 * whatsapp.contactos.service.js — libreta de contactos de WhatsApp. Se
 * alimenta sola (whatsapp.service.js#procesarMensajeEntrante llama a
 * upsertContacto con cada mensaje entrante, y enviarRecordatorioCita /
 * whatsapp.mensajeria.service#enviarMensajeTexto con cada saliente) y
 * también es editable a mano (nombre, etiquetas, opt-out de promociones).
 */
const { pool } = require('../../config/db');
const { ultimos10, aE164, badRequest } = require('./whatsapp.util');
const { getScoped } = require('../pos/pos.tenant.helpers');

async function getScopedContacto(empresaId, id) {
  return getScoped(pool, 'whatsapp_contactos', id, empresaId, { notFoundMsg: 'Contacto no encontrado' });
}

// Busca el id de contacto por teléfono — usado por registrarMensajeSaliente
// cuando el llamador no trae ya el contacto resuelto (ver whatsapp.service.js).
async function buscarPorTelefono(empresaId, telefono) {
  const [[row]] = await pool.query(
    'SELECT id FROM whatsapp_contactos WHERE empresa_id = ? AND telefono_normalizado = ?',
    [empresaId, ultimos10(telefono)]
  );
  return row?.id || null;
}

// Punto único para dejar constancia de un mensaje saliente en whatsapp_mensajes
// (bandeja, respuestas automáticas del bot, plantillas masivas, recordatorios de
// cita) — antes cada llamador resolvía el contacto e insertaba por su cuenta.
async function registrarMensajeSaliente(empresaId, telefonoE164, { tipo, contenido, waMessageId, contactoId, enviadoPor } = {}) {
  const idContacto = contactoId !== undefined ? contactoId : await buscarPorTelefono(empresaId, telefonoE164);
  await pool.query(
    `INSERT INTO whatsapp_mensajes (empresa_id, contacto_id, tipo, direccion, telefono, contenido, wa_message_id, estatus, leido, enviado_por)
     VALUES (?, ?, ?, 'saliente', ?, ?, ?, 'enviado', 1, ?)`,
    [empresaId, idContacto, tipo, telefonoE164, contenido, waMessageId || null, enviadoPor || null]
  );
}

// Normalización compartida por alta manual y edición (nombre/etiquetas/notas
// como texto libre recortado, opt-out de promociones con default "sí acepta").
function normalizarContacto({ nombre, etiquetas, notas, acepta_promociones }) {
  return {
    nombre: nombre?.trim() || null,
    etiquetas: etiquetas?.trim() || null,
    notas: notas?.trim() || null,
    acepta_promociones: acepta_promociones === false ? 0 : 1,
  };
}

// Da de alta o refresca el contacto al vuelo con cualquier mensaje (entrante
// o saliente). `nombre` solo se guarda si el contacto no tenía uno ya puesto
// a mano — no pisa un nombre que el empleado ya haya corregido.
async function upsertContacto(empresaId, telefono, { nombre } = {}) {
  const normalizado = ultimos10(telefono);
  if (normalizado.length !== 10) throw badRequest('Teléfono inválido');

  const [rows] = await pool.query(
    'SELECT id, nombre FROM whatsapp_contactos WHERE empresa_id = ? AND telefono_normalizado = ?',
    [empresaId, normalizado]
  );
  if (rows.length) {
    await pool.query(
      `UPDATE whatsapp_contactos SET ultimo_contacto_en = NOW(), nombre = COALESCE(nombre, ?) WHERE id = ?`,
      [nombre?.trim() || null, rows[0].id]
    );
    return rows[0].id;
  }
  const [r] = await pool.query(
    `INSERT INTO whatsapp_contactos (empresa_id, telefono, telefono_normalizado, nombre, primer_contacto_en, ultimo_contacto_en)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [empresaId, telefono, normalizado, nombre?.trim() || null]
  );
  return r.insertId;
}

async function listarContactos(empresaId, { q, etiqueta } = {}) {
  const params = [empresaId];
  let where = 'empresa_id = ?';
  if (q) {
    where += ' AND (nombre LIKE ? OR telefono_normalizado LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (etiqueta) {
    where += ' AND FIND_IN_SET(?, REPLACE(etiquetas, ", ", ","))';
    params.push(etiqueta);
  }
  const [rows] = await pool.query(
    `SELECT * FROM whatsapp_contactos WHERE ${where} ORDER BY ultimo_contacto_en DESC, nombre`,
    params
  );
  return rows;
}

// Todas las etiquetas usadas (para el selector del envío masivo).
async function listarEtiquetas(empresaId) {
  const [rows] = await pool.query(
    'SELECT etiquetas FROM whatsapp_contactos WHERE empresa_id = ? AND etiquetas IS NOT NULL AND etiquetas != ""',
    [empresaId]
  );
  const set = new Set();
  rows.forEach((r) => String(r.etiquetas).split(',').forEach((e) => { const t = e.trim(); if (t) set.add(t); }));
  return [...set].sort();
}

async function crearContactoManual(empresaId, { telefono, nombre, etiquetas, notas, acepta_promociones }, usuarioId) {
  if (!telefono?.trim()) throw badRequest('Teléfono requerido');
  const normalizado = ultimos10(telefono);
  if (normalizado.length !== 10) throw badRequest('Teléfono inválido (deben ser 10 dígitos, con o sin lada 52)');

  const [existe] = await pool.query(
    'SELECT id FROM whatsapp_contactos WHERE empresa_id = ? AND telefono_normalizado = ?',
    [empresaId, normalizado]
  );
  if (existe.length) throw badRequest('Ya existe un contacto con ese teléfono');

  const c = normalizarContacto({ nombre, etiquetas, notas, acepta_promociones });
  const [r] = await pool.query(
    `INSERT INTO whatsapp_contactos
       (empresa_id, telefono, telefono_normalizado, nombre, etiquetas, notas, acepta_promociones, creado_por, primer_contacto_en, ultimo_contacto_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [empresaId, aE164(normalizado), normalizado, c.nombre, c.etiquetas, c.notas, c.acepta_promociones, usuarioId]
  );
  return { id: r.insertId };
}

async function actualizarContacto(empresaId, id, { nombre, etiquetas, notas, acepta_promociones }) {
  await getScopedContacto(empresaId, id);
  const c = normalizarContacto({ nombre, etiquetas, notas, acepta_promociones });
  await pool.query(
    `UPDATE whatsapp_contactos
     SET nombre = ?, etiquetas = ?, notas = ?, acepta_promociones = ?
     WHERE id = ? AND empresa_id = ?`,
    [c.nombre, c.etiquetas, c.notas, c.acepta_promociones, id, empresaId]
  );
  return { ok: true };
}

module.exports = {
  upsertContacto, listarContactos, listarEtiquetas, crearContactoManual, actualizarContacto, getScopedContacto,
  buscarPorTelefono, registrarMensajeSaliente,
};
