/**
 * whatsapp.chatbot.service.js — Mini chatbot con IA para mensajes libres de
 * WhatsApp que no son respuesta a nada nuestro (no botón, no reprogramación
 * de cita pendiente — ver whatsapp.service.js#procesarMensajeEntrante).
 *
 * Contesta con datos reales de la BD (nunca inventa) para horario,
 * medico_turno y producto; y con respuestas fijas de negocio (tabla
 * whatsapp_faqs, editable desde Configuración → WhatsApp → Preguntas
 * frecuentes — ver whatsapp.faqs.service.js y migrate_v44) para el resto:
 *   - horario: si la sucursal está abierta ahora / horario de la semana.
 *   - medico_turno: quién está en turno en este momento (medico_horarios,
 *     ver migrate_v43 — informativo, no liga con pos_citas).
 *   - producto: precio + existencia real (reusa buscarProductos del POS).
 *   - faq_<id>: preguntas frecuentes de negocio con respuesta fija
 *     (domicilio, cobertura, controlados, etc.) — el prompt del clasificador
 *     se arma dinámicamente con las filas activas de whatsapp_faqs, así que
 *     agregar/editar una FAQ no requiere tocar este archivo.
 * Cualquier otra intención devuelve null y el llamador no contesta nada
 * (mejor no responder que alucinar).
 *
 * generarRespuesta() nunca lanza: un fallo de Gemini o de la consulta no debe
 * romper el procesamiento del webhook de WhatsApp.
 */
const { pool } = require('../../config/db');
const { extraerJSON } = require('../../config/ai.provider');
const carrito = require('./whatsapp.carrito.service');

// Intenciones que arman/mueven el carrito de pedido (ver whatsapp.carrito.service.js)
// — se distinguen de "producto" (solo pregunta informativa) por la fase.
const INTENTS_CARRITO = ['agregar_producto', 'ver_carrito', 'quitar_producto', 'confirmar_pedido', 'cancelar_pedido'];

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

async function cargarFaqsActivas(empresaId) {
  const [rows] = await pool.query(
    'SELECT id, pregunta, respuesta FROM whatsapp_faqs WHERE empresa_id = ? AND activo = 1 ORDER BY orden, id',
    [empresaId]
  );
  return rows;
}

function construirSystemClasificador(faqs) {
  const enumFaqs = faqs.map((f) => `"faq_${f.id}"`).join(' | ');
  const descripcionesFaqs = faqs.map((f) => `- "faq_${f.id}": ${f.pregunta}`).join('\n');
  return `Eres un clasificador de intención para mensajes de WhatsApp de una farmacia con consultorio médico.
Devuelve SOLO un JSON con esta forma exacta, sin texto adicional:
{"intent": "horario" | "medico_turno" | "producto" | "agregar_producto" | "ver_carrito" | "quitar_producto" | "confirmar_pedido" | "cancelar_pedido"${faqs.length ? ` | ${enumFaqs}` : ''} | "otro", "producto_query": string|null, "cantidad": number|null}

- "horario": pregunta si están abiertos, a qué hora abren/cierran, horario de atención de la farmacia.
- "medico_turno": pregunta si hay médico/doctor, quién está de turno o si hay consulta disponible ahora.
- "producto": SOLO pregunta informativa (precio, si lo tienen) SIN intención de pedirlo. "producto_query" el nombre tal cual lo mencionó, sin inventar ni corregir.
- "agregar_producto": el cliente quiere PEDIR/COMPRAR/AGREGAR un producto a su pedido (ej. "quiero 2 jeringas", "me mandas 3 cajas de gasas", "agrégame paracetamol"). "producto_query" el nombre del producto; "cantidad" el número si lo dijo, o null si no.
- "ver_carrito": pregunta qué lleva en su pedido/carrito hasta ahora.
- "quitar_producto": quiere quitar o cancelar un producto específico de su pedido (no todo el pedido). "producto_query" el nombre a quitar.
- "confirmar_pedido": quiere cerrar/confirmar/terminar su pedido tal como está (ej. "es todo", "ya confirmo", "eso es todo, ciérralo").
- "cancelar_pedido": quiere cancelar TODO el pedido/carrito completo.
${descripcionesFaqs ? descripcionesFaqs + '\n' : ''}- "otro": saludo, queja, o cualquier cosa que no sea claramente una de las anteriores. Ante la duda, usa "otro".`;
}

function fmtHora(t) {
  return String(t).slice(0, 5);
}

async function clasificarIntencion(texto, faqs) {
  const system = construirSystemClasificador(faqs);
  const { text } = await extraerJSON({ system, user: texto, maxTokens: 200 });
  const data = JSON.parse(text);
  const intentsValidos = ['horario', 'medico_turno', 'producto', 'otro', ...INTENTS_CARRITO, ...faqs.map((f) => `faq_${f.id}`)];
  return {
    intent: intentsValidos.includes(data.intent) ? data.intent : 'otro',
    producto_query: typeof data.producto_query === 'string' ? data.producto_query.trim() : null,
    cantidad: typeof data.cantidad === 'number' && data.cantidad > 0 ? data.cantidad : null,
  };
}

async function responderHorarioSucursal(empresaId) {
  const suc = await carrito.resolverSucursal(empresaId);
  if (!suc) return 'Por el momento no tengo esa información. Un asesor te contestará en breve.';

  const [horarios] = await pool.query(
    `SELECT dia_semana, hora_inicio, hora_fin, cerrado FROM sucursal_horarios
     WHERE sucursal_id = ? ORDER BY dia_semana`,
    [suc.id]
  );
  if (!horarios.length) return 'Por el momento no tengo cargado el horario de atención. Un asesor te contestará en breve.';

  const [[ahora]] = await pool.query('SELECT WEEKDAY(NOW()) + 1 AS dia, TIME(NOW()) AS hora');
  const hoy = horarios.find((h) => h.dia_semana === ahora.dia);

  let estadoHoy;
  if (!hoy || hoy.cerrado) {
    estadoHoy = `Hoy (${DIAS[ahora.dia]}) estamos cerrados.`;
  } else {
    const abierto = ahora.hora >= hoy.hora_inicio && ahora.hora <= hoy.hora_fin;
    estadoHoy = abierto
      ? `Sí, estamos abiertos. Hoy (${DIAS[ahora.dia]}) el horario es de ${fmtHora(hoy.hora_inicio)} a ${fmtHora(hoy.hora_fin)}.`
      : `En este momento estamos cerrados. Hoy (${DIAS[ahora.dia]}) el horario es de ${fmtHora(hoy.hora_inicio)} a ${fmtHora(hoy.hora_fin)}.`;
  }

  const resto = horarios
    .filter((h) => h.dia_semana !== ahora.dia)
    .map((h) => `${DIAS[h.dia_semana]}: ${h.cerrado ? 'cerrado' : `${fmtHora(h.hora_inicio)} a ${fmtHora(h.hora_fin)}`}`)
    .join('\n');

  return resto ? `${estadoHoy}\n\nHorario completo:\n${resto}` : estadoHoy;
}

async function responderMedicoEnTurno(empresaId) {
  const [turnos] = await pool.query(
    `SELECT m.nombre, m.especialidad, mh.dia_semana, mh.hora_inicio, mh.hora_fin
     FROM medico_horarios mh
     JOIN medicos m ON m.id = mh.medico_id AND m.activo = 1
     WHERE mh.empresa_id = ?
     ORDER BY mh.dia_semana, mh.hora_inicio`,
    [empresaId]
  );
  if (!turnos.length) return 'Por el momento no tengo cargados los turnos de los médicos. Un asesor te puede confirmar disponibilidad.';

  const [[ahora]] = await pool.query('SELECT WEEKDAY(NOW()) + 1 AS dia, TIME(NOW()) AS hora');

  const listado = Object.entries(
    turnos.reduce((acc, t) => {
      (acc[t.nombre] ||= []).push(`${DIAS[t.dia_semana]} ${fmtHora(t.hora_inicio)} a ${fmtHora(t.hora_fin)}`);
      return acc;
    }, {})
  ).map(([nombre, rangos]) => `• ${nombre}: ${rangos.join(', ')}`).join('\n');

  const enTurno = turnos.find((t) => t.dia_semana === ahora.dia && ahora.hora >= t.hora_inicio && ahora.hora <= t.hora_fin);
  if (enTurno) {
    const especialidad = enTurno.especialidad ? ` (${enTurno.especialidad})` : '';
    return `Sí, en este momento está en turno ${enTurno.nombre}${especialidad}, hasta las ${fmtHora(enTurno.hora_fin)}.\n\nHorario de médicos:\n${listado}`;
  }

  // Nadie en turno ahora: buscar el próximo (hoy más tarde, o el día más
  // próximo de la semana — si un turno de hoy ya terminó, cuenta como si
  // fuera la próxima semana, no "más tarde hoy").
  const conDistancia = turnos.map((t) => {
    let dias = (t.dia_semana - ahora.dia + 7) % 7;
    if (dias === 0 && t.hora_inicio <= ahora.hora) dias = 7;
    return { ...t, dias };
  });
  conDistancia.sort((a, b) => a.dias - b.dias || (a.hora_inicio < b.hora_inicio ? -1 : 1));
  const proximo = conDistancia[0];
  const especialidad = proximo.especialidad ? ` (${proximo.especialidad})` : '';
  const cuando = proximo.dias === 0
    ? `hoy más tarde, a las ${fmtHora(proximo.hora_inicio)}`
    : `el ${DIAS[proximo.dia_semana]}, de ${fmtHora(proximo.hora_inicio)} a ${fmtHora(proximo.hora_fin)}`;

  return `En este momento no hay médico en turno. El próximo es ${proximo.nombre}${especialidad}, ${cuando}.\n\nHorario de médicos:\n${listado}`;
}

// Punto de entrada único. Nunca lanza: cualquier error (Gemini, BD) se traga
// y devuelve null, para que el llamador simplemente no conteste nada en vez
// de romper el procesamiento del webhook. `contacto` = {id, telefono} — lo
// necesitan las intenciones de carrito (whatsapp.carrito.service), que son
// por-contacto; el resto de intenciones lo ignoran. Devuelve siempre
// { texto, botones?, lista? } o null, nunca un string suelto (ver
// whatsapp.service#procesarMensajeEntrante, que envía botones/lista si
// vienen, o texto plano si no).
async function generarRespuesta(empresaId, contacto, texto) {
  try {
    const faqs = await cargarFaqsActivas(empresaId);
    const { intent, producto_query, cantidad } = await clasificarIntencion(texto, faqs);
    if (intent.startsWith('faq_')) {
      const id = Number(intent.slice(4));
      const respuesta = faqs.find((f) => f.id === id)?.respuesta;
      return respuesta ? { texto: respuesta } : null;
    }
    if (INTENTS_CARRITO.includes(intent)) {
      return await carrito.manejarIntencionIA(empresaId, contacto, intent, { producto_query, cantidad });
    }
    switch (intent) {
      case 'horario': return { texto: await responderHorarioSucursal(empresaId) };
      case 'medico_turno': return { texto: await responderMedicoEnTurno(empresaId) };
      case 'producto': return await carrito.mostrarProductoConOpcionAgregar(empresaId, contacto, producto_query || texto);
      default: return null;
    }
  } catch (err) {
    console.warn('[whatsapp.chatbot] no se pudo generar respuesta:', err.message);
    return null;
  }
}

module.exports = { generarRespuesta };
