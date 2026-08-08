/**
 * whatsapp.campanas.service.js — envío masivo (promociones) a un grupo de
 * contactos usando una plantilla YA APROBADA por Meta: fuera de la ventana
 * de 24h desde su último mensaje, un negocio solo puede escribirle a un
 * contacto con una plantilla (nunca con texto libre), así que esto es lo
 * único que hace posible mandar una promoción a quien no te ha escrito hoy.
 *
 * v1 deliberadamente simple (ver whatsapp.plantillas.util): solo plantillas
 * con 0 o 1 variable de texto (típicamente el nombre del destinatario) y sin
 * header de imagen/video/documento. Envío secuencial en el mismo proceso
 * (sin cola ni reintentos) — de sobra para el volumen de contactos de una
 * farmacia; si el catálogo de contactos crece mucho, mover esto a una cola
 * de verdad es la mejora natural de fase 2.
 */
const { pool } = require('../../config/db');
const client = require('./whatsapp.client');
const { analizarPlantilla, armarComponentes } = require('./whatsapp.plantillas.util');
const { badRequest } = require('./whatsapp.util');
const { getScoped } = require('../pos/pos.tenant.helpers');
const contactosService = require('./whatsapp.contactos.service');

const PAUSA_ENTRE_ENVIOS_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listarPlantillasDisponibles() {
  const plantillas = await client.listarPlantillasAprobadas();
  return plantillas.map((t) => ({
    name: t.name,
    language: t.language,
    category: t.category,
    ...analizarPlantilla(t),
  }));
}

async function obtenerPlantilla(templateName, templateLang) {
  const plantillas = await client.listarPlantillasAprobadas();
  const t = plantillas.find((p) => p.name === templateName && p.language === templateLang);
  if (!t) throw badRequest('Esa plantilla ya no está disponible o no está aprobada');
  return t;
}

async function crearCampana(empresaId, {
  nombre, template_name, template_lang, personalizar_nombre, variable_valor, filtro_etiqueta,
}, usuarioId) {
  if (!nombre?.trim() || !template_name || !template_lang) {
    throw badRequest('nombre, template_name y template_lang son requeridos');
  }
  const template = await obtenerPlantilla(template_name, template_lang);
  const analisis = analizarPlantilla(template);
  if (!analisis.soportada) throw badRequest(analisis.motivo);
  if (analisis.variable && !personalizar_nombre && !variable_valor?.trim()) {
    throw badRequest('Esta plantilla tiene una variable — captura un texto fijo o marca "usar nombre del contacto"');
  }

  const params = [empresaId];
  let where = 'empresa_id = ? AND acepta_promociones = 1';
  if (filtro_etiqueta) {
    where += ' AND FIND_IN_SET(?, REPLACE(etiquetas, ", ", ","))';
    params.push(filtro_etiqueta);
  }
  const [destinatarios] = await pool.query(
    `SELECT id, nombre FROM whatsapp_contactos WHERE ${where}`, params
  );
  if (!destinatarios.length) throw badRequest('No hay contactos que reciban promociones con ese filtro');

  const [r] = await pool.query(
    `INSERT INTO whatsapp_campanas
       (empresa_id, nombre, template_name, template_lang, variable_valor, personalizar_nombre,
        filtro_etiqueta, total_destinatarios, estatus, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enviando', ?)`,
    [empresaId, nombre.trim(), template_name, template_lang, variable_valor?.trim() || null,
     personalizar_nombre ? 1 : 0, filtro_etiqueta?.trim() || null, destinatarios.length, usuarioId || null]
  );
  const campanaId = r.insertId;

  await pool.query(
    'INSERT INTO whatsapp_campana_destinatarios (campana_id, contacto_id) VALUES ?',
    [destinatarios.map((d) => [campanaId, d.id])]
  );

  // No se espera aquí: el envío corre en segundo plano y el llamador (el
  // controller) responde de inmediato con el id para que la pantalla
  // consulte el progreso (ver detalleCampana) mientras avanza.
  procesarCampana(campanaId, empresaId, template, { personalizar_nombre, variable_valor }).catch((err) => {
    console.error('[whatsapp] error procesando campaña', campanaId, err.message);
  });

  return { id: campanaId, total_destinatarios: destinatarios.length };
}

async function procesarCampana(campanaId, empresaId, template, { personalizar_nombre, variable_valor }) {
  const [destinatarios] = await pool.query(
    `SELECT d.id AS destinatario_id, c.id AS contacto_id, c.telefono, c.nombre
     FROM whatsapp_campana_destinatarios d JOIN whatsapp_contactos c ON c.id = d.contacto_id
     WHERE d.campana_id = ? AND d.estatus = 'pendiente'`,
    [campanaId]
  );

  for (const dest of destinatarios) {
    const valorVariable = personalizar_nombre ? (dest.nombre || '') : (variable_valor || '');
    const componentes = armarComponentes(template, valorVariable);
    try {
      const waMessageId = await client.enviarPlantillaGenerica({
        telefonoE164: dest.telefono,
        templateName: template.name,
        templateLang: template.language,
        componentes,
      });
      await Promise.all([
        pool.query(
          `UPDATE whatsapp_campana_destinatarios SET estatus = 'enviado', wa_message_id = ?, enviado_en = NOW() WHERE id = ?`,
          [waMessageId, dest.destinatario_id]
        ),
        contactosService.registrarMensajeSaliente(empresaId, dest.telefono, {
          tipo: 'plantilla_masiva', contenido: `[plantilla: ${template.name}]`, waMessageId, contactoId: dest.contacto_id,
        }),
        pool.query('UPDATE whatsapp_campanas SET enviados = enviados + 1 WHERE id = ?', [campanaId]),
      ]);
    } catch (err) {
      await Promise.all([
        pool.query(
          `UPDATE whatsapp_campana_destinatarios SET estatus = 'fallo', error = ? WHERE id = ?`,
          [err.message.slice(0, 255), dest.destinatario_id]
        ),
        pool.query('UPDATE whatsapp_campanas SET fallidos = fallidos + 1 WHERE id = ?', [campanaId]),
      ]);
    }
    await sleep(PAUSA_ENTRE_ENVIOS_MS);
  }

  await pool.query(`UPDATE whatsapp_campanas SET estatus = 'completada', terminado_en = NOW() WHERE id = ?`, [campanaId]);
}

async function listarCampanas(empresaId) {
  const [rows] = await pool.query(
    `SELECT c.*, u.nombre AS creado_por_nombre
     FROM whatsapp_campanas c LEFT JOIN usuarios u ON u.id = c.creado_por
     WHERE c.empresa_id = ? ORDER BY c.created_at DESC`,
    [empresaId]
  );
  return rows;
}

async function detalleCampana(empresaId, id) {
  const campana = await getScoped(pool, 'whatsapp_campanas', id, empresaId, { notFoundMsg: 'Campaña no encontrada' });
  const [destinatarios] = await pool.query(
    `SELECT d.estatus, d.error, d.enviado_en, c.nombre, c.telefono_normalizado
     FROM whatsapp_campana_destinatarios d JOIN whatsapp_contactos c ON c.id = d.contacto_id
     WHERE d.campana_id = ? ORDER BY d.id`,
    [id]
  );
  return { ...campana, destinatarios };
}

module.exports = { listarPlantillasDisponibles, crearCampana, listarCampanas, detalleCampana };
