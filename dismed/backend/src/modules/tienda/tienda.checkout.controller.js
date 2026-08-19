/**
 * tienda.checkout.controller.js — capa HTTP delgada sobre
 * tienda.checkout.service.js. El webhook verifica la firma de Stripe ANTES
 * de responder nada (al revés de whatsapp.controller.js#webhookReceive, que
 * responde 200 y verifica después — ese atajo no es aceptable en un webhook
 * que mueve dinero): firma inválida -> 400 y no se procesa nada; fallo
 * transitorio (BD caída) -> 500, que Stripe reintente; fallo de negocio
 * permanente (sin existencia) lo resuelve el propio service cancelando y
 * reembolsando, y aquí se responde 200 normal.
 */
const { resolverEmpresaUnica } = require('../../config/empresa');
const stripeConfig = require('./tienda.stripe.config');
const checkoutService = require('./tienda.checkout.service');

async function iniciar(req, res, next) {
  try {
    const empresaId = await resolverEmpresaUnica();
    if (!empresaId) return res.status(503).json({ error: 'No disponible por el momento' });
    const { url } = await checkoutService.iniciar(empresaId, req.body, {
      ip: req.ip,
      clienteFidelidadId: req.cliente?.id || null,
    });
    res.json({ url });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

async function webhook(req, res) {
  const stripe = stripeConfig.cliente();
  const { webhookSecret } = stripeConfig.get();
  if (!stripe || !webhookSecret) return res.sendStatus(503);

  let event;
  try {
    const firma = req.get('stripe-signature');
    event = stripe.webhooks.constructEvent(req.rawBody, firma, webhookSecret);
  } catch (err) {
    console.error('[tienda-checkout] firma de webhook inválida:', err.message);
    return res.sendStatus(400);
  }

  // Suscrito solo a checkout.session.completed en el dashboard de Stripe —
  // si algún día se agrega otro evento por error, se ignora aquí también en
  // vez de intentar procesarlo con la forma equivocada.
  if (event.type !== 'checkout.session.completed') return res.sendStatus(200);

  try {
    await checkoutService.confirmarPago(event.data.object);
    res.sendStatus(200);
  } catch (err) {
    console.error('[tienda-checkout] error procesando webhook, Stripe reintentará:', event.id, err.message);
    res.sendStatus(500);
  }
}

async function confirmacion(req, res, next) {
  try {
    const data = await checkoutService.buscarPorSession(req.query.session_id);
    res.json(data);
  } catch (err) { next(err); }
}

module.exports = { iniciar, webhook, confirmacion };
