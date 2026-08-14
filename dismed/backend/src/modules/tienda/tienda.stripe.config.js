/**
 * tienda.stripe.config.js — variables de entorno del cobro en línea con
 * Stripe Checkout en /tienda. Ambas opcionales: sin ellas, el resto del
 * sistema sigue funcionando igual (el carrito/checkout se oculta por
 * completo en el catálogo público, igual que TIENDA_WHATSAPP_NUMERO oculta
 * su botón cuando no está configurado — ver tienda.controller.js#info).
 *
 * `cliente()` hace el require('stripe') de forma PEREZOSA (nunca en el
 * top-level del archivo): así el servidor arranca limpio en cualquier
 * instancia que aún no tenga STRIPE_SECRET_KEY, sin que un `npm install`
 * pendiente o una variable faltante tumbe todo el backend por una función
 * que nadie está usando.
 */
function get() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  };
}

function estaConfigurado() {
  return !!get().secretKey;
}

let _cliente = null;
function cliente() {
  const { secretKey } = get();
  if (!secretKey) return null;
  if (!_cliente) _cliente = require('stripe')(secretKey);
  return _cliente;
}

module.exports = { get, estaConfigurado, cliente };
