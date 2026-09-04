/**
 * tiktokEventsApi.service.js — Events API de TikTok (eventos server-side hacia
 * el Pixel de TikTok). Equivalente a metaCapi.service.js: cuenta las compras
 * que se confirman fuera del navegador para las campañas de TikTok Ads.
 *
 * Doc: https://business-api.tiktok.com/portal/docs?id=1771100965992450
 * (Events API 2.0 — endpoint /event/track/)
 *
 * NUNCA lanza: cualquier fallo se registra y se devuelve { ok:false }.
 */
const crypto = require('crypto');
const adsConfig = require('../modules/tienda/tienda.ads.config');

const TIMEOUT_MS = 6000;
const ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

// TikTok pide SHA-256 (hex) de email/teléfono normalizados igual que Meta:
// minúsculas + trim para email; teléfono en E.164 (con '+') solo dígitos.
function hashEmail(email) {
  if (!email) return undefined;
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

function hashTelefono(tel) {
  const digitos = String(tel || '').replace(/\D/g, '');
  if (!digitos) return undefined;
  const conLada = digitos.length === 10 ? `52${digitos}` : digitos;
  return crypto.createHash('sha256').update(`+${conLada}`).digest('hex');
}

function hashPlano(valor) {
  if (!valor) return undefined;
  return crypto.createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

/**
 * enviarEvento — un evento a la Events API de TikTok.
 *
 * @param {object}  p
 * @param {string}  p.pixelId      Pixel Code de TikTok (de branding, no secreto)
 * @param {string}  p.eventName    'CompletePayment', 'PlaceAnOrder', ...
 * @param {string} [p.eventId]     para deduplicar contra el pixel de navegador
 * @param {string} [p.url]         URL donde ocurrió
 * @param {object} [p.userData]    { email, phone, clientIp, clientUserAgent, ttclid, externalId }
 * @param {object} [p.properties]  { currency, value, contents: [{content_id, quantity, price}] }
 * @returns {Promise<{ok:boolean, status?:number, error?:string}>}
 */
async function enviarEvento({
  pixelId, eventName, eventId, url, userData = {}, properties = {},
} = {}) {
  const { accessToken, testEventCode } = adsConfig.tiktok();
  if (!accessToken || !pixelId) return { ok: false, error: 'tiktok events sin configurar' };

  const user = {
    email: hashEmail(userData.email),
    phone: hashTelefono(userData.phone),
    external_id: hashPlano(userData.externalId),
    ip: userData.clientIp || undefined,
    user_agent: userData.clientUserAgent || undefined,
    ttclid: userData.ttclid || undefined,
  };
  Object.keys(user).forEach((k) => user[k] === undefined && delete user[k]);

  const evento = {
    event: eventName,
    event_time: Math.floor(Date.now() / 1000),
    ...(eventId ? { event_id: eventId } : {}),
    user,
    properties,
    ...(url ? { page: { url } } : {}),
  };

  const body = {
    event_source: 'web',
    event_source_id: pixelId,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [evento],
  };

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await resp.text();
    // TikTok responde 200 con { code: 0 } en éxito; code != 0 es error de negocio.
    let json = null;
    try { json = JSON.parse(texto); } catch { /* deja json en null */ }
    if (!resp.ok || (json && json.code !== 0)) {
      console.error('[tiktokEvents] TikTok respondió', resp.status, texto.slice(0, 500));
      return { ok: false, status: resp.status, error: texto.slice(0, 900) };
    }
    return { ok: true, status: resp.status, error: null };
  } catch (e) {
    console.error('[tiktokEvents] error enviando evento:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarEvento };
