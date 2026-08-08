/**
 * whatsapp.client.js — capa delgada sobre la Graph API de Meta (WhatsApp
 * Cloud API). No hay reintentos elaborados aquí: si Meta responde error, se
 * propaga tal cual (el llamador decide qué hacer, igual que ai.provider.js
 * con Gemini).
 */
const config = require('./whatsapp.config');

function noConfigurado() {
  const err = new Error('WhatsApp no está configurado (faltan WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN en el entorno)');
  err.status = 503;
  return err;
}

async function llamarGraphAPI(path, body) {
  if (!config.estaConfigurado()) throw noConfigurado();
  const { graphBase, accessToken } = config.get();
  const resp = await fetch(`${graphBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Meta manda varios campos útiles además de .message (código, subcódigo,
    // error_data.details con la razón específica) — se arma todo, sin
    // recortar, para no perder la pista real detrás de un "(#100)" genérico.
    const e = data?.error || {};
    const partes = [
      e.message,
      e.error_data?.details,
      e.error_user_msg,
      e.code != null ? `code=${e.code}` : null,
      e.error_subcode != null ? `subcode=${e.error_subcode}` : null,
      e.fbtrace_id ? `fbtrace_id=${e.fbtrace_id}` : null,
    ].filter(Boolean);
    const detalle = partes.length ? partes.join(' | ') : JSON.stringify(data);
    const err = new Error(`WhatsApp API ${resp.status}: ${detalle}`);
    err.status = 502;
    throw err;
  }
  return data;
}

// Plantilla aprobada por Meta con 3 botones de respuesta rápida (payloads
// CITA_CONFIRMAR / CITA_REPROGRAMAR / CITA_CANCELAR) usando PARÁMETROS CON
// NOMBRE (no {{1}}/{{2}} posicionales) — Meta exige "parameter_name" en cada
// parámetro cuando la plantilla se creó así, si no tira "(#100) Parameter
// name is missing or empty". header = { parameter_name, texto }; body =
// [{ parameter_name, texto }, ...] en el orden real de la plantilla
// (whatsapp.service.js arma esto: header=nombre, body=fecha/hora/servicio).
async function enviarPlantillaRecordatorio({ telefonoE164, header, body }) {
  const { phoneNumberId, templateName, templateLang } = config.get();
  const data = await llamarGraphAPI(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: telefonoE164,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: [
        { type: 'header', parameters: [{ type: 'text', parameter_name: header.nombre, text: header.texto }] },
        { type: 'body', parameters: body.map((v) => ({ type: 'text', parameter_name: v.nombre, text: v.texto })) },
      ],
    },
  });
  return data?.messages?.[0]?.id || null;
}

// Mensaje de texto libre: solo permitido por Meta dentro de la ventana de
// 24h desde el último mensaje del paciente (si no, hay que usar plantilla).
async function enviarTextoLibre({ telefonoE164, texto }) {
  const { phoneNumberId } = config.get();
  const data = await llamarGraphAPI(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: telefonoE164,
    type: 'text',
    text: { body: texto },
  });
  return data?.messages?.[0]?.id || null;
}

// Plantillas aprobadas del WABA — la usa el envío masivo (whatsapp.campanas)
// para dejar elegir solo entre las que Meta ya aprobó, y para saber qué
// variables trae cada una (ver whatsapp.plantillas.util#parseVariables).
async function listarPlantillasAprobadas() {
  const { wabaId, graphBase, accessToken } = config.get();
  if (!wabaId) return [];
  const resp = await fetch(
    `${graphBase}/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(`WhatsApp API ${resp.status}: ${data?.error?.message || 'error al listar plantillas'}`);
    err.status = 502;
    throw err;
  }
  return (data.data || []).filter((t) => t.status === 'APPROVED');
}

// Envío genérico de plantilla (a diferencia de enviarPlantillaRecordatorio,
// que es específica de citas): `componentes` ya viene armado exactamente
// como lo espera Graph API — ver whatsapp.plantillas.util#armarComponentes,
// que decide si cada variable usa parameter_name (nombrada) o posición
// (numérica) según cómo se haya creado la plantilla real en Meta.
async function enviarPlantillaGenerica({ telefonoE164, templateName, templateLang, componentes }) {
  const { phoneNumberId } = config.get();
  const data = await llamarGraphAPI(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: telefonoE164,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLang },
      components: componentes,
    },
  });
  return data?.messages?.[0]?.id || null;
}

// Botones de respuesta rápida (hasta 3, título ≤20 caracteres) — mensaje de
// SESIÓN (no requiere plantilla aprobada), solo válido dentro de la ventana
// de 24h. Los usa el carrito de pedidos (whatsapp.carrito.service) para
// Agregar/Ver carrito/Confirmar, entrega, forma de pago, etc. `botones` es
// [{ id, titulo }] — `id` es el payload que vuelve en
// msg.interactive.button_reply.id (ver whatsapp.service#procesarMensajeEntrante).
async function enviarBotones({ telefonoE164, texto, botones }) {
  const { phoneNumberId } = config.get();
  const data = await llamarGraphAPI(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: telefonoE164,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.titulo.slice(0, 20) },
        })),
      },
    },
  });
  return data?.messages?.[0]?.id || null;
}

// Lista desplegable (hasta 10 filas, título ≤24 caracteres, descripción ≤72)
// — se usa cuando la búsqueda de producto trae varias coincidencias y hay
// que dejar que el cliente elija cuál quiso decir. `filas` es
// [{ id, titulo, descripcion }]; vuelve en msg.interactive.list_reply.id.
async function enviarLista({ telefonoE164, texto, botonMenu = 'Elegir', filas }) {
  const { phoneNumberId } = config.get();
  const data = await llamarGraphAPI(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: telefonoE164,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: texto },
      action: {
        button: botonMenu.slice(0, 20),
        sections: [{
          title: 'Opciones',
          rows: filas.slice(0, 10).map((f) => ({
            id: f.id,
            title: f.titulo.slice(0, 24),
            description: (f.descripcion || '').slice(0, 72),
          })),
        }],
      },
    },
  });
  return data?.messages?.[0]?.id || null;
}

// Foto de receta que manda el paciente (Cloud API entrega solo un media id;
// hay que resolver su URL temporal y descargarla aparte, ambas peticiones
// con el mismo Bearer token). Devuelve el buffer + mime_type; el llamador
// decide dónde guardarlo (ver whatsapp.service#procesarMensajeEntrante).
async function descargarMedia(mediaId) {
  if (!config.estaConfigurado()) throw noConfigurado();
  const { graphBase, accessToken } = config.get();
  const metaResp = await fetch(`${graphBase}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaResp.json().catch(() => ({}));
  if (!metaResp.ok || !meta.url) {
    throw new Error(`No se pudo resolver la URL del media ${mediaId}: ${meta?.error?.message || metaResp.status}`);
  }
  const fileResp = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileResp.ok) throw new Error(`No se pudo descargar el media ${mediaId}: ${fileResp.status}`);
  const buffer = Buffer.from(await fileResp.arrayBuffer());
  return { buffer, mimeType: meta.mime_type || fileResp.headers.get('content-type') || 'application/octet-stream' };
}

// Paso único de puesta en marcha (ver README): suscribe esta app a los
// eventos del WABA (mensajes entrantes y estatus). Usa las credenciales YA
// puestas en el .env (WHATSAPP_WABA_ID/WHATSAPP_ACCESS_TOKEN).
async function suscribirWebhook() {
  const { wabaId } = config.get();
  if (!wabaId) throw new Error('Falta WHATSAPP_WABA_ID en el entorno');
  return llamarGraphAPI(`/${wabaId}/subscribed_apps`, {});
}

module.exports = {
  llamarGraphAPI, enviarPlantillaRecordatorio, enviarTextoLibre, suscribirWebhook,
  listarPlantillasAprobadas, enviarPlantillaGenerica,
  enviarBotones, enviarLista, descargarMedia,
};
