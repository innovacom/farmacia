/**
 * whatsapp.config.js — variables de entorno de la integración con
 * WhatsApp Cloud API (Meta), con un número dedicado que NUNCA tuvo WhatsApp
 * (alta estándar, sin Coexistence). Todas opcionales: sin ellas, el resto
 * del sistema sigue funcionando igual (el botón de WhatsApp en
 * Citas/VentaMostrador cae de vuelta al enlace wa.me manual).
 *
 * Ver src/modules/whatsapp/README.md para cómo obtenerlas.
 */
const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';

function get() {
  return {
    appSecret: process.env.META_APP_SECRET || '',
    wabaId: process.env.WHATSAPP_WABA_ID || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    templateName: process.env.WHATSAPP_TEMPLATE_RECORDATORIO || 'recordatorio_cita',
    templateLang: process.env.WHATSAPP_TEMPLATE_RECORDATORIO_LANG || 'es_MX',
    graphApiVersion: GRAPH_API_VERSION,
    graphBase: `https://graph.facebook.com/${GRAPH_API_VERSION}`,
  };
}

// Lo mínimo para poder ENVIAR mensajes (recibir solo requiere webhookVerifyToken,
// que se valida aparte en el handshake de GET /webhook).
function estaConfigurado() {
  const c = get();
  return !!(c.phoneNumberId && c.accessToken);
}

module.exports = { get, estaConfigurado };
