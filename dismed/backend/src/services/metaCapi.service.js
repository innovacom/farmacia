/**
 * metaCapi.service.js — Conversions API de Meta (eventos server-side hacia el
 * Pixel/Dataset). Sirve para que las campañas de Facebook/Instagram cuenten
 * las compras que se confirman FUERA del navegador (webhook de Stripe,
 * confirmación de pedido por WhatsApp) — ver DISEÑO_ADS_META_TIKTOK.md.
 *
 * Doc: https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * NUNCA lanza: cualquier fallo (sin config, red, 4xx de Meta) se registra y
 * se devuelve { ok:false } — un problema de medición jamás debe tumbar un
 * cobro o un pedido.
 */
const crypto = require('crypto');
const adsConfig = require('../modules/tienda/tienda.ads.config');

const TIMEOUT_MS = 6000;

// Meta exige SHA-256 (hex) de los datos de contacto, normalizados: minúsculas
// y sin espacios; el teléfono solo dígitos con lada de país, sin '+'.
function hash(valor) {
  if (!valor) return undefined;
  return crypto.createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

function hashTelefono(tel) {
  const digitos = String(tel || '').replace(/\D/g, '');
  if (!digitos) return undefined;
  // 10 dígitos => se asume México (52). Si ya trae lada, se deja.
  const conLada = digitos.length === 10 ? `52${digitos}` : digitos;
  return crypto.createHash('sha256').update(conLada).digest('hex');
}

/**
 * enviarEvento — un evento a la Conversions API.
 *
 * @param {object}  p
 * @param {string}  p.pixelId          Dataset/Pixel ID (de branding, no secreto)
 * @param {string}  p.eventName        'Purchase', 'Lead', ...
 * @param {string} [p.eventId]         para deduplicar contra el pixel de navegador
 * @param {string} [p.eventSourceUrl]  URL donde ocurrió (si aplica)
 * @param {string} [p.actionSource]    'website' (default) | 'chat' | 'system_generated'
 * @param {object} [p.userData]        { email, phone, clientIp, clientUserAgent, fbc, fbp, ctwaClid }
 * @param {object} [p.customData]      { currency, value, contents, ... }
 * @returns {Promise<{ok:boolean, status?:number, error?:string}>}
 */
async function enviarEvento({
  pixelId, eventName, eventId, eventSourceUrl, actionSource = 'website',
  userData = {}, customData = {},
} = {}) {
  const { graphVersion, accessToken, testEventCode } = adsConfig.meta();
  if (!accessToken || !pixelId) return { ok: false, error: 'meta capi sin configurar' };

  const user_data = {
    em: hash(userData.email),
    ph: hashTelefono(userData.phone),
    client_ip_address: userData.clientIp || undefined,
    client_user_agent: userData.clientUserAgent || undefined,
    fbc: userData.fbc || undefined,
    fbp: userData.fbp || undefined,
    // Click-to-WhatsApp: Meta lo quiere sin hashear, en su propio campo.
    ctwa_clid: userData.ctwaClid || undefined,
  };
  // Limpia undefined para no mandar llaves vacías.
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const evento = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    ...(eventId ? { event_id: eventId } : {}),
    ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
    user_data,
    custom_data: customData,
  };

  const body = {
    data: [evento],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      console.error('[metaCapi] Meta respondió', resp.status, texto.slice(0, 500));
      return { ok: false, status: resp.status, error: texto.slice(0, 900) };
    }
    return { ok: true, status: resp.status, error: null };
  } catch (e) {
    console.error('[metaCapi] error enviando evento:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarEvento };
