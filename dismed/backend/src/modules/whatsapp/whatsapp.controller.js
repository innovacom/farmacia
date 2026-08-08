const crypto = require('crypto');
const config = require('./whatsapp.config');
const service = require('./whatsapp.service');

async function estado(req, res) {
  res.json({ configurado: config.estaConfigurado() });
}

// Handshake de verificación (Meta lo llama una vez al guardar la URL del
// webhook en la app de developers.facebook.com).
function webhookVerify(req, res) {
  const { 'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  const { webhookVerifyToken } = config.get();
  if (modo === 'subscribe' && webhookVerifyToken && token === webhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

// Firma HMAC-SHA256 del body crudo con el App Secret — evita que cualquiera
// que adivine la URL pueda mandar eventos falsos (ej. "confirmar" citas
// ajenas). Requiere que app.js capture req.rawBody (ver verify de express.json).
function firmaValida(req) {
  const { appSecret } = config.get();
  const firma = req.get('X-Hub-Signature-256');
  if (!appSecret || !firma || !req.rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperado));
  } catch {
    return false;
  }
}

// Meta espera 200 rápido y reintenta agresivamente si no lo obtiene — por
// eso se responde de inmediato y cualquier error de procesamiento solo se
// loguea (ver whatsapp.service.procesarWebhookBody), nunca se regresa como 4xx/5xx.
async function webhookReceive(req, res) {
  res.sendStatus(200);
  if (!firmaValida(req)) {
    console.error('[whatsapp] webhook con firma inválida o no configurada — evento descartado');
    return;
  }
  try {
    await service.procesarWebhookBody(req.body);
  } catch (err) {
    console.error('[whatsapp] error procesando webhook:', err.message);
  }
}

module.exports = { estado, webhookVerify, webhookReceive };
