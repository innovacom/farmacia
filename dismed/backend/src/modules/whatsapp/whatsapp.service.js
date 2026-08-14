/**
 * whatsapp.service.js — puente entre la agenda de citas (pos_citas) y la
 * WhatsApp Cloud API. Dos direcciones:
 *   - enviarRecordatorioCita: dispara la plantilla aprobada y registra el
 *     mensaje en whatsapp_mensajes (para poder ligar la respuesta después).
 *   - procesarWebhookBody: recibe el payload crudo de Meta, resuelve a qué
 *     cita corresponde cada respuesta (vía context.id) y aplica la acción
 *     (confirmar/reprogramar/cancelar) reusando pos.citas.service — o sea,
 *     una confirmación por WhatsApp tiene el mismo efecto que si el empleado
 *     hubiera dado clic en "Confirmar" (misma tabla, mismas reglas).
 *
 * Número dedicado exclusivamente a esto (nunca tuvo WhatsApp antes) — solo se
 * suscribe el campo estándar 'messages' del webhook, no hace falta nada de
 * Coexistence. Cualquier campo/evento no reconocido igual se guarda tal cual
 * en whatsapp_eventos, por si acaso, en vez de descartarlo silenciosamente.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../config/db');
const client = require('./whatsapp.client');
const citas = require('../pos/pos.citas.service');
const contactosService = require('./whatsapp.contactos.service');
const chatbot = require('./whatsapp.chatbot.service');
const carrito = require('./whatsapp.carrito.service');
const waConfig = require('./whatsapp.config.service');
const { aE164 } = require('./whatsapp.util');
const { resolverEmpresaUnica } = require('../../config/empresa');

const RECETAS_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads', 'whatsapp-recetas');
if (!fs.existsSync(RECETAS_DIR)) fs.mkdirSync(RECETAS_DIR, { recursive: true });

// Sin mensajes entrantes de este contacto en las últimas N horas se considera
// conversación nueva y se antepone el saludo de bienvenida (whatsapp_config,
// ver migrate_v49) a lo que conteste el chatbot — así cualquier variante de
// apertura ("hola", "buenas tardes", "disculpe"...) queda cubierta sin tener
// que reconocerla por texto.
const NUEVA_SESION_HORAS = 8;

async function esConversacionNueva(contactoId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total FROM whatsapp_mensajes
     WHERE contacto_id = ? AND direccion = 'entrante' AND created_at >= NOW() - INTERVAL ? HOUR`,
    [contactoId, NUEVA_SESION_HORAS]
  );
  return row.total <= 1; // el propio mensaje que se acaba de insertar ya cuenta
}

// Payloads REALES que manda la plantilla ya aprobada por Meta (confirmado
// viendo whatsapp_eventos): son el texto literal del botón, no un código
// como "CITA_CONFIRMAR". "Reprogamar" está mal escrito en la plantilla real
// (falta una "r"), pero como Meta lo manda tal cual hay que matchearlo así.
const PAYLOAD_ACCION = {
  Asistire: 'confirmar',
  Reprogamar: 'reprogramar',
  Cancelare: 'cancelar',
};

// El número de WhatsApp es UNO SOLO por instancia (whatsapp.config.js lee un
// solo .env) — en la práctica todas las empresas de esta instancia comparten
// el mismo número. Cuando un mensaje entrante no viene ligado a nada nuestro
// (primera vez que escribe, sin context.id), no hay forma de saber de qué
// empresa es más que inferirlo con resolverEmpresaUnica() (ver config/empresa.js).

// Texto legible para guardar en whatsapp_mensajes.contenido — no se descarga
// media en esta versión (fase 2), solo se deja constancia del tipo.
function extraerTexto(msg) {
  if (msg.type === 'text') return msg.text?.body || '';
  if (msg.button) return msg.button.text || msg.button.payload || '';
  if (msg.interactive?.type === 'button_reply') return msg.interactive.button_reply.title || '';
  return `[mensaje de tipo ${msg.type || 'desconocido'}]`;
}

// pos_citas.fecha llega de mysql2 como objeto Date (no string) — String(fecha)
// da "Thu Jul 30 2026 ..." (sin guiones), por eso NO se puede recortar como
// texto. Se usan los getters LOCALES (no UTC) para no correr el día si el
// proceso corre en otra zona horaria.
function fmtFecha(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(`${String(fecha).slice(0, 10)}T12:00:00`);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function logEvento(tipo, payload) {
  await pool.query(
    'INSERT INTO whatsapp_eventos (tipo, payload_json) VALUES (?, ?)',
    [tipo, JSON.stringify(payload).slice(0, 60000)]
  );
}

// Respuestas de texto libre al paciente (agradecimiento/aviso/preguntas) —
// solo válido dentro de la ventana de 24h desde su último mensaje, que es
// justo el caso aquí (siempre se manda como reacción a algo que él escribió).
// Si falla (ventana cerrada, número inválido, etc.) se registra pero no debe
// tumbar el webhook. También se guarda en whatsapp_mensajes para que estas
// respuestas automáticas aparezcan en el historial de la bandeja general,
// igual que si un empleado las hubiera escrito a mano.
async function enviarTexto(empresaId, telefonoE164, texto, { contactoId } = {}) {
  try {
    const waMessageId = await client.enviarTextoLibre({ telefonoE164, texto });
    await contactosService.registrarMensajeSaliente(empresaId, telefonoE164, {
      tipo: 'respuesta_automatica', contenido: texto, waMessageId, contactoId,
    });
  } catch (err) {
    await logEvento('error_envio_texto', { telefonoE164, texto, error: err.message });
  }
}

// Igual que enviarTexto, pero para respuestas del carrito de pedidos (ver
// whatsapp.carrito.service.js) que pueden traer botones o una lista
// interactiva además del texto. Se manda como interactive.button/list si
// vienen, texto libre si no — un solo mensaje de WhatsApp por respuesta.
async function enviarRespuestaBot(empresaId, telefonoE164, respuesta, { contactoId } = {}) {
  if (!respuesta?.texto) return;
  try {
    let waMessageId;
    if (respuesta.botones?.length) {
      waMessageId = await client.enviarBotones({ telefonoE164, texto: respuesta.texto, botones: respuesta.botones });
    } else if (respuesta.lista?.filas?.length) {
      waMessageId = await client.enviarLista({
        telefonoE164, texto: respuesta.texto,
        botonMenu: respuesta.lista.botonMenu, filas: respuesta.lista.filas,
      });
    } else {
      waMessageId = await client.enviarTextoLibre({ telefonoE164, texto: respuesta.texto });
    }
    await contactosService.registrarMensajeSaliente(empresaId, telefonoE164, {
      tipo: 'respuesta_automatica', contenido: respuesta.texto, waMessageId, contactoId,
    });
  } catch (err) {
    await logEvento('error_envio_respuesta_bot', { telefonoE164, respuesta, error: err.message });
  }
}

async function enviarRecordatorioCita(empresaId, citaId, { usuario_id } = {}) {
  const cita = await citas.detalleCita(empresaId, citaId);
  const telefonoE164 = aE164(cita.paciente_telefono);
  if (!telefonoE164) {
    const err = new Error('La cita no tiene teléfono del paciente registrado');
    err.status = 400;
    throw err;
  }

  const waMessageId = await client.enviarPlantillaRecordatorio({
    telefonoE164,
    header: { nombre: 'nombre', texto: cita.paciente_nombre },
    body: [
      { nombre: 'fecha', texto: fmtFecha(cita.fecha) },
      { nombre: 'hora', texto: cita.hora_inicio.slice(0, 5) },
      { nombre: 'servicio', texto: cita.servicio_descripcion || 'su cita' },
    ],
  });

  // Da de alta/refresca el contacto para que el recordatorio también
  // aparezca en el historial de la bandeja general (whatsapp.mensajeria).
  const contactoId = await contactosService
    .upsertContacto(empresaId, telefonoE164, { nombre: cita.paciente_nombre })
    .catch(() => null);

  await pool.query(
    `INSERT INTO whatsapp_mensajes (empresa_id, cita_id, contacto_id, tipo, direccion, telefono, contenido, wa_message_id, enviado_por)
     VALUES (?, ?, ?, 'recordatorio_cita', 'saliente', ?, ?, ?, ?)`,
    [empresaId, citaId, contactoId,
     telefonoE164, `Recordatorio de cita: ${fmtFecha(cita.fecha)} ${cita.hora_inicio.slice(0, 5)} (${cita.servicio_descripcion || 'consulta'})`,
     waMessageId, usuario_id || null]
  );
  return { ok: true, wa_message_id: waMessageId };
}

// Ejecuta la acción del botón reusando las reglas normales de pos_citas
// (usuario_id null = "no fue un empleado, fue el paciente por WhatsApp") y le
// contesta al paciente lo que corresponde en cada caso. Los errores esperados
// (cita ya cobrada/cancelada/confirmada) solo se registran — el webhook
// siempre debe responder 200 a Meta.
async function aplicarAccion(empresaId, citaId, accion, telefonoE164) {
  try {
    if (accion === 'confirmar') {
      await citas.confirmarCita(empresaId, citaId, { usuario_id: null });
      await enviarTexto(empresaId, telefonoE164, '¡Gracias por confirmar tu cita! Te esperamos.');
    } else if (accion === 'cancelar') {
      await citas.cancelarCita(empresaId, citaId, { motivo: 'Cancelada por el paciente vía WhatsApp', usuario_id: null });
      await enviarTexto(empresaId, telefonoE164, 'Tu cita fue cancelada, como lo pediste. Si quieres agendar de nuevo, contáctanos cuando gustes.');
    } else if (accion === 'reprogramar') {
      await citas.marcarReprogramarSolicitado(empresaId, citaId);
      await enviarTexto(
        empresaId, telefonoE164,
        'Claro, ¿para qué nueva fecha y hora te gustaría tu cita? Respóndeme en este formato: DD/MM/AAAA HH:MM (ejemplo: 05/08/2026 11:00).'
      );
    }
  } catch (err) {
    await logEvento('accion_no_aplicada', { empresaId, citaId, accion, error: err.message });
    await enviarTexto(empresaId, telefonoE164, `No pudimos aplicar tu solicitud: ${err.message}. Por favor contáctanos directamente.`);
  }
}

const RE_FECHA_HORA = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})\D+(\d{1,2}):(\d{2})/;

// Solo entra aquí cuando ya se le preguntó "¿para qué nueva fecha y hora?"
// (reprogramar_solicitado = 1) y el paciente contesta con texto libre en vez
// de un botón. Se busca el mensaje de recordatorio más reciente de ese
// teléfono que quedó marcado como "reprogramar" y sigue pendiente.
// Devuelve true si había una reprogramación pendiente (la manejó, con o sin
// éxito) — false si no había nada pendiente, para que el llamador sepa que
// puede intentar el chatbot en vez de dar el mensaje por no ligado.
async function intentarReprogramarPorTexto(msg) {
  const telefono = msg.from;
  const texto = msg.text?.body || '';
  // Comparar solo los últimos 10 dígitos (no el string completo): WhatsApp
  // manda los números mexicanos con un "1" extra después del 52
  // (ej. 5215525201610) que aE164() no agrega al mandar el recordatorio
  // (525525201610) — mismo celular, distinta cantidad de dígitos.
  const [[pendiente]] = await pool.query(
    `SELECT wm.empresa_id, wm.cita_id
     FROM whatsapp_mensajes wm
     JOIN pos_citas c ON c.id = wm.cita_id
     WHERE RIGHT(wm.telefono, 10) = RIGHT(?, 10) AND wm.respuesta_payload = 'reprogramar'
       AND c.reprogramar_solicitado = 1 AND c.estatus = 'agendada'
     ORDER BY wm.respuesta_en DESC LIMIT 1`,
    [telefono]
  );
  if (!pendiente) return false;

  const m = texto.match(RE_FECHA_HORA);
  if (!m) {
    await enviarTexto(pendiente.empresa_id, telefono, 'No entendí la fecha y hora. Respóndeme así: DD/MM/AAAA HH:MM (ejemplo: 05/08/2026 11:00).');
    return true;
  }

  const [, dd, mm, yyyy, hh, mi] = m;
  const fecha = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const hora_inicio = `${hh.padStart(2, '0')}:${mi}`;
  try {
    const cita = await citas.detalleCita(pendiente.empresa_id, pendiente.cita_id);
    await citas.updateCita(pendiente.empresa_id, pendiente.cita_id, {
      fecha,
      hora_inicio,
      producto_id: cita.producto_id,
      paciente_nombre: cita.paciente_nombre,
      paciente_telefono: cita.paciente_telefono,
      notas: cita.notas,
    });
    await enviarTexto(
      pendiente.empresa_id, telefono,
      `Listo, tu cita quedó para el ${dd.padStart(2, '0')}/${mm.padStart(2, '0')}/${yyyy} a las ${hh.padStart(2, '0')}:${mi}. ¡Te esperamos!`
    );
  } catch (err) {
    await enviarTexto(pendiente.empresa_id, telefono, `No se pudo reprogramar: ${err.message}. Intenta con otra fecha/hora (DD/MM/AAAA HH:MM).`);
  }
  return true;
}

// Punto de entrada único de cualquier mensaje entrante. Primero registra el
// mensaje crudo en la bandeja general (contacto + whatsapp_mensajes) sin
// importar de qué se trate — eso es lo que alimenta whatsapp.mensajeria; ese
// registro es "mejor esfuerzo" (nunca debe impedir que el flujo de citas de
// abajo se ejecute, que es lo que ya está en producción y probado). Después
// sigue exactamente la misma lógica de siempre para botones/reprogramar.
async function procesarMensajeEntrante(msg) {
  // idInteractivo cubre AMBOS tipos de respuesta interactiva de sesión
  // (button_reply Y list_reply) — las citas solo usan button_reply de
  // plantilla (msg.button.payload); el carrito de pedidos (prefijo WA_, ver
  // whatsapp.carrito.service) puede llegar por cualquiera de los dos.
  const idInteractivo = msg.interactive?.type === 'button_reply' ? msg.interactive.button_reply.id
    : msg.interactive?.type === 'list_reply' ? msg.interactive.list_reply.id
    : null;
  const payload = msg.button?.payload || idInteractivo;
  const contextId = msg.context?.id;
  const accion = payload ? PAYLOAD_ACCION[payload] : null;

  let original = null;
  if (contextId) {
    const [[row]] = await pool.query(
      'SELECT empresa_id, cita_id FROM whatsapp_mensajes WHERE wa_message_id = ?',
      [contextId]
    );
    original = row || null;
  }

  // Se resuelve una sola vez y se reusa tanto para la bandeja general como
  // para el chatbot de abajo — con el mismo criterio "mejor esfuerzo" (si
  // falla, empresaId queda null y ninguno de los dos pasos se ejecuta).
  let empresaId = original?.empresa_id || null;
  if (!empresaId) {
    try { empresaId = await resolverEmpresaUnica(); }
    catch { empresaId = null; }
  }

  let contactoId = null;
  try {
    if (empresaId) {
      contactoId = await contactosService.upsertContacto(empresaId, msg.from, {});
      await pool.query(
        `INSERT IGNORE INTO whatsapp_mensajes (empresa_id, contacto_id, tipo, direccion, telefono, contenido, wa_message_id, estatus, leido)
         VALUES (?, ?, 'entrante', 'entrante', ?, ?, ?, 'entregado', 0)`,
        [empresaId, contactoId, msg.from, extraerTexto(msg), msg.id || null]
      );
    }
  } catch (err) {
    await logEvento('error_registro_bandeja', { msg, error: err.message });
  }

  if (accion && contextId) {
    if (!original?.cita_id) {
      await logEvento('respuesta_sin_mensaje_original', { contextId, msg });
      return;
    }

    // Se guarda la acción normalizada ("confirmar"/"cancelar"/"reprogramar"),
    // no el payload crudo del botón — intentarReprogramarPorTexto busca por
    // este valor, y el texto literal del botón puede cambiar si se edita la
    // plantilla en Meta.
    await pool.query(
      'UPDATE whatsapp_mensajes SET respuesta_payload = ?, respuesta_en = NOW() WHERE wa_message_id = ?',
      [accion, contextId]
    );
    await aplicarAccion(original.empresa_id, original.cita_id, accion, msg.from);
    return;
  }

  const contacto = { id: contactoId, telefono: msg.from };

  // Botón/lista del carrito de pedidos (prefijo WA_, ver
  // whatsapp.carrito.service). Se revisa ANTES de todo lo demás porque
  // idInteractivo nunca es un mensaje de tipo 'text' (no cae en el bloque de
  // abajo) y, a diferencia de citas, no depende de contextId/wa_message_id.
  if (idInteractivo && empresaId && contactoId) {
    try {
      const respuestaCarrito = await carrito.manejarBoton(empresaId, contacto, idInteractivo);
      if (respuestaCarrito) {
        await enviarRespuestaBot(empresaId, msg.from, respuestaCarrito, { contactoId });
        return;
      }
    } catch (err) {
      await logEvento('error_carrito_boton', { msg, error: err.message });
      await enviarTexto(empresaId, msg.from, 'Tuvimos un problema procesando tu pedido. Intenta de nuevo o contáctanos directamente.', { contactoId });
      return;
    }
  }

  // Foto de receta médica: solo se procesa si hay un pedido de este contacto
  // esperándola (receta_estatus='pendiente') — cualquier otra imagen entrante
  // no se descarga (fase 2 general, ver extraerTexto), solo queda registrada
  // en la bandeja como "[mensaje de tipo image]".
  if (msg.type === 'image' && empresaId && contactoId) {
    try {
      const pedido = await carrito.pedidoEsperandoReceta(empresaId, contactoId);
      if (pedido) {
        const { buffer, mimeType } = await client.descargarMedia(msg.image?.id);
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const rutaCompleta = path.join(RECETAS_DIR, `receta_${pedido.folio}_${Date.now()}.${ext}`);
        fs.writeFileSync(rutaCompleta, buffer);
        await carrito.guardarFotoReceta(pedido.id, rutaCompleta);
        await enviarTexto(empresaId, msg.from, `Recibimos tu receta para el pedido ${pedido.folio}. En breve la valida un farmacéutico y te confirmamos.`, { contactoId });
        return;
      }
    } catch (err) {
      await logEvento('error_receta_foto', { msg, error: err.message });
    }
  }

  if (msg.type === 'text') {
    const yaAtendido = await intentarReprogramarPorTexto(msg);
    if (yaAtendido) return;

    // Paso de carrito pendiente (cantidad/dirección/nombre/forma de
    // pago/confirmación final) se resuelve DETERMINISTA, sin pasar por el
    // clasificador de IA — evita que "10" o una dirección se malinterprete.
    if (empresaId && contactoId) {
      try {
        const pasoCarrito = await carrito.manejarPasoPendiente(empresaId, contacto, msg.text?.body || '');
        if (pasoCarrito.manejado) {
          await enviarRespuestaBot(empresaId, msg.from, pasoCarrito.respuesta, { contactoId });
          return;
        }
      } catch (err) {
        await logEvento('error_carrito_paso', { msg, error: err.message });
      }
    }

    // Nada pendiente: se le da oportunidad al mini chatbot (horario / médico
    // en turno / producto / carrito de pedido) antes de dar el mensaje por
    // no ligado. Si es el primer mensaje de una conversación nueva se
    // antepone el saludo de bienvenida (whatsapp_config). Si no hay ni
    // saludo ni intención reconocida (o algo falla), no contesta nada.
    if (empresaId) {
      let saludo = null;
      try {
        if (contactoId && await esConversacionNueva(contactoId)) {
          saludo = await waConfig.obtenerSaludo(empresaId);
        }
      } catch (err) {
        await logEvento('error_saludo_bienvenida', { msg, error: err.message });
      }
      const respuestaBot = await chatbot.generarRespuesta(empresaId, contacto, msg.text?.body || '');
      const texto = [saludo, respuestaBot?.texto].filter(Boolean).join('\n\n');
      if (texto) {
        await enviarRespuestaBot(empresaId, msg.from, { texto, botones: respuestaBot?.botones, lista: respuestaBot?.lista }, { contactoId });
        return;
      }
    }
  }

  await logEvento('mensaje_no_ligado', msg);
}

async function procesarEstatus(status) {
  const estatusMap = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallo' };
  const estatus = estatusMap[status.status];
  if (!estatus) return;
  await pool.query(
    'UPDATE whatsapp_mensajes SET estatus = ? WHERE wa_message_id = ?',
    [estatus, status.id]
  );
}

async function procesarWebhookBody(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'messages') {
        const value = change.value || {};
        for (const msg of value.messages || []) await procesarMensajeEntrante(msg);
        for (const status of value.statuses || []) await procesarEstatus(status);
      } else {
        // Campo inesperado (no debería llegar, solo se suscribió 'messages'):
        // se registra tal cual por si hay que revisarlo.
        await logEvento(change.field || 'desconocido', change.value);
      }
    }
  }
}

module.exports = { enviarRecordatorioCita, procesarWebhookBody, enviarTexto };
