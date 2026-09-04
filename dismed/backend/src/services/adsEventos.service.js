/**
 * adsEventos.service.js — un solo punto para disparar el evento de "compra"
 * a Meta (Conversions API) y TikTok (Events API) desde donde se confirma una
 * venta real: el webhook de Stripe (tienda.checkout.service.js) y la
 * confirmación de pedido por WhatsApp (whatsapp.carrito.service.js).
 *
 * Los pixel IDs salen de branding (empresas_config, editables por el admin);
 * los tokens de tienda.ads.config (env). Si nada está configurado, esto es
 * un no-op silencioso.
 *
 * NUNCA lanza — el llamador lo envuelve además en su propio try/catch, pero
 * aquí ya se atrapa todo: una campaña sin medición no puede tumbar un cobro.
 */
const { pool } = require('../config/db');
const branding = require('./branding.service');
const metaCapi = require('./metaCapi.service');
const tiktokEvents = require('./tiktokEventsApi.service');

// Meta: 'Purchase'. TikTok: 'CompletePayment'. Mismo hecho, distinto nombre.
async function registrarCompra({
  empresaId, origen, folio, valor, moneda = 'MXN',
  email, telefono, clientIp, clientUserAgent, eventSourceUrl,
  ctwaClid, contents,
} = {}) {
  if (!empresaId || !valor) return;

  let metaPixelId = null;
  let tiktokPixelId = null;
  try {
    const b = await branding.getBranding(empresaId);
    metaPixelId = b.config.meta_pixel_id || null;
    tiktokPixelId = b.config.tiktok_pixel_id || null;
  } catch (e) {
    console.error('[adsEventos] no se pudo leer branding:', e.message);
    return;
  }
  if (!metaPixelId && !tiktokPixelId) return;

  // event_id determinista: el pixel de navegador (cuando exista, ej. checkout
  // de Stripe iniciado desde /tienda) manda el mismo id y Meta/TikTok
  // deduplican en vez de contar doble.
  const eventId = `${origen}-${folio}`;
  const valorNum = Math.round(Number(valor) * 100) / 100;
  const actionSource = origen === 'whatsapp' ? 'chat' : 'website';

  const tareas = [];

  if (metaPixelId) {
    tareas.push(
      metaCapi.enviarEvento({
        pixelId: metaPixelId,
        eventName: 'Purchase',
        eventId,
        eventSourceUrl,
        actionSource,
        userData: { email, phone: telefono, clientIp, clientUserAgent, ctwaClid },
        customData: {
          currency: moneda,
          value: valorNum,
          ...(contents ? { contents, content_type: 'product' } : {}),
        },
      }).then((r) => bitacora(empresaId, 'meta', 'Purchase', origen, folio, eventId, r))
    );
  }

  if (tiktokPixelId) {
    tareas.push(
      tiktokEvents.enviarEvento({
        pixelId: tiktokPixelId,
        eventName: 'CompletePayment',
        eventId,
        url: eventSourceUrl,
        userData: { email, phone: telefono, clientIp, clientUserAgent, externalId: telefono || email },
        properties: {
          currency: moneda,
          value: valorNum,
          ...(contents ? { contents } : {}),
        },
      }).then((r) => bitacora(empresaId, 'tiktok', 'CompletePayment', origen, folio, eventId, r))
    );
  }

  await Promise.allSettled(tareas);
}

async function bitacora(empresaId, plataforma, evento, origen, referencia, eventId, resultado) {
  try {
    await pool.query(
      `INSERT INTO tienda_eventos_ads (empresa_id, plataforma, evento, origen, referencia, event_id, exito, respuesta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, plataforma, evento, origen, referencia || null, eventId || null,
       resultado?.ok ? 1 : 0, (resultado?.error || null)?.toString().slice(0, 1000) || null]
    );
  } catch (e) {
    // La tabla puede no existir aún (migrate_v71 sin correr) — no pasa nada.
    console.error('[adsEventos] no se pudo escribir bitácora:', e.message);
  }
}

module.exports = { registrarCompra };
