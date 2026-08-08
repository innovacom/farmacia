/**
 * whatsapp_suscribir.js — node whatsapp_suscribir.js
 * Paso único de puesta en marcha: le dice a Meta que mande los eventos del
 * WABA (mensajes, estatus, y en Coexistence también smb_message_echoes /
 * smb_app_state_sync) al webhook configurado en la App de developers.facebook.com.
 * Se corre UNA VEZ después de tener WHATSAPP_WABA_ID/WHATSAPP_ACCESS_TOKEN en
 * el .env. Ver src/modules/whatsapp/README.md para todos los pasos previos.
 */
require('dotenv').config();
const client = require('./src/modules/whatsapp/whatsapp.client');

(async () => {
  try {
    const data = await client.suscribirWebhook();
    console.log('OK — app suscrita al WABA:', JSON.stringify(data));
  } catch (err) {
    console.error('Error al suscribir:', err.message);
    process.exitCode = 1;
  }
})();
