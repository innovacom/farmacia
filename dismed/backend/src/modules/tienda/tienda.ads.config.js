/**
 * tienda.ads.config.js — variables de entorno de la publicidad en Meta
 * (Facebook/Instagram) y TikTok para el catálogo público /tienda. Mismo
 * patrón que tienda.stripe.config.js: todo opcional, lectura perezosa,
 * `estaConfigurado()` por plataforma.
 *
 * Se agrupó Meta + TikTok en UN solo archivo (el diseño original proponía
 * dos) porque el contrato es idéntico y así el bloque de .env queda junto.
 *
 * Qué es secreto y qué no:
 *  - Los *_PIXEL_ID son públicos (van embebidos en el HTML de la tienda) y NO
 *    se leen aquí: se capturan desde el admin y viven en empresas_config
 *    (branding.service.js claves `meta_pixel_id` / `tiktok_pixel_id`).
 *  - Los tokens de la Conversions API / Events API SÍ son secretos: solo
 *    .env.server, nunca en branding ni expuestos al navegador.
 *  - FEED_TOKEN protege el feed de catálogo (URL pública que descargan
 *    Meta/TikTok por calendario, sin OAuth) para que no cualquiera raspe la
 *    lista de precios. Sin FEED_TOKEN configurado, el feed responde 404.
 */

// Versión de la Graph API para el endpoint de Conversions API. Fija aquí
// (no en .env) para que un bump se revise en código; Meta mantiene cada
// versión ~2 años.
const META_GRAPH_VERSION = 'v21.0';

function meta() {
  return {
    graphVersion: META_GRAPH_VERSION,
    accessToken: process.env.META_CAPI_ACCESS_TOKEN || '',
    // Código del Test Events tool del Events Manager: mientras esté puesto,
    // los eventos llegan SOLO a la pestaña de pruebas (no a la campaña real).
    // Quitar para producción.
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE || '',
  };
}

function tiktok() {
  return {
    accessToken: process.env.TIKTOK_EVENTS_ACCESS_TOKEN || '',
    testEventCode: process.env.TIKTOK_TEST_EVENT_CODE || '',
  };
}

function feedToken() {
  return process.env.FEED_TOKEN || '';
}

/** ¿Se puede mandar un evento server-side a Meta? (token + un pixel id). */
function metaCapiConfigurado(pixelId) {
  return !!(meta().accessToken && pixelId);
}

/** ¿Se puede mandar un evento server-side a TikTok? (token + un pixel id). */
function tiktokEventsConfigurado(pixelId) {
  return !!(tiktok().accessToken && pixelId);
}

module.exports = {
  META_GRAPH_VERSION,
  meta,
  tiktok,
  feedToken,
  metaCapiConfigurado,
  tiktokEventsConfigurado,
};
