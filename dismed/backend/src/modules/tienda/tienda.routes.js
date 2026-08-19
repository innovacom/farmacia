// Rutas del catálogo público — SIN auth (a diferencia de todo el resto del
// sistema). Ver tienda.controller.js para el detalle de qué expone.
//
// Este router es la excepción a "todo requiere auth": mezcla rutas públicas
// (catálogo, checkout, webhook de Stripe) con rutas de staff más abajo
// (Fase 4, pedidos de la tienda) — mismo patrón que whatsapp.routes.js.
// NUNCA agregar un `router.use(auth)` global aquí.
const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const authCliente = require('../../middleware/authCliente');
const { authClienteOpcional } = require('../../middleware/authCliente');
const { requirePermiso } = require('../../middleware/permisos');
const { publicoLecturaLimiter, publicoEscrituraLimiter, loginLimiter } = require('../../middleware/rateLimit');
const c = require('./tienda.controller');
const checkout = require('./tienda.checkout.controller');
const pedidos = require('./tienda.pedidos.controller');
const cuenta = require('./tienda.cuenta.controller');

// admin-only inline, mismo patrón que empresas.routes.js/marketing.routes.js
const adminOnly = (req, res, next) =>
  (req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo administradores' }));

// ── público ──────────────────────────────────────────────────────────────
// Sin rate limit: /stripe/webhook (lo llama Stripe, ya validado por firma).
router.get('/info',          publicoLecturaLimiter, c.info);
router.get('/legal',         publicoLecturaLimiter, c.legalTexto);
router.get('/sitemap.xml',   publicoLecturaLimiter, c.sitemap);
router.post('/suscriptores', publicoEscrituraLimiter, c.suscribir);
router.get('/categorias',    publicoLecturaLimiter, c.categorias);
router.get('/productos',     publicoLecturaLimiter, c.productosList);
router.get('/productos/:id', publicoLecturaLimiter, c.productoDetalle);

// authClienteOpcional: si viene un token de cliente válido liga el pedido a
// su cuenta; si no (invitado, como hasta hoy), no bloquea nada.
router.post('/checkout/iniciar',    publicoEscrituraLimiter, authClienteOpcional, checkout.iniciar);
router.post('/stripe/webhook',      checkout.webhook);
router.get ('/pedido-confirmacion', publicoLecturaLimiter, checkout.confirmacion);

// ── cuenta de cliente (Entrega 2) ───────────────────────────────────────
// Sin contraseña: código de un solo uso por WhatsApp. /codigo usa el
// limiter de escritura general (cuesta un mensaje real); /verificar usa
// loginLimiter (10 intentos/15min por IP, igual que el login de staff) —
// es el punto de fuerza bruta del código de 6 dígitos.
router.post('/cuenta/codigo',    publicoEscrituraLimiter, cuenta.solicitarCodigo);
router.post('/cuenta/verificar', loginLimiter,            cuenta.verificarCodigo);
router.get   ('/cuenta/perfil',            authCliente, cuenta.perfil);
router.put   ('/cuenta/perfil',            authCliente, cuenta.actualizarPerfil);
router.get   ('/cuenta/pedidos',           authCliente, cuenta.pedidos);
router.get   ('/cuenta/pedidos/:origen/:id', authCliente, cuenta.detallePedido);

// ── staff — pedidos pagados en la tienda ────────────────────────────────
router.get ('/admin/pedidos',              auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.listar);
router.get ('/admin/pedidos/:id',          auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.detalle);
router.post('/admin/pedidos/:id/preparar', auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.preparar);
router.post('/admin/pedidos/:id/listo',    auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.listo);
router.post('/admin/pedidos/:id/reparto',  auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.reparto);
router.post('/admin/pedidos/:id/entregar', auth, tenant, requirePermiso('pos-pedidos-tienda'), pedidos.entregar);
// cancelar dispara un reembolso REAL por Stripe — admin-only, no el permiso
// general (a diferencia de cancelar un pedido de WhatsApp, que nunca cobró nada).
router.post('/admin/pedidos/:id/cancelar', auth, tenant, adminOnly, pedidos.cancelar);

module.exports = router;
