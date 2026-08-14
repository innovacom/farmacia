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
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./tienda.controller');
const checkout = require('./tienda.checkout.controller');
const pedidos = require('./tienda.pedidos.controller');

// admin-only inline, mismo patrón que empresas.routes.js/marketing.routes.js
const adminOnly = (req, res, next) =>
  (req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo administradores' }));

// ── público ──────────────────────────────────────────────────────────────
router.get('/info',          c.info);
router.get('/legal',         c.legalTexto);
router.get('/sitemap.xml',   c.sitemap);
router.post('/suscriptores', c.suscribir);
router.get('/categorias',    c.categorias);
router.get('/productos',     c.productosList);
router.get('/productos/:id', c.productoDetalle);

router.post('/checkout/iniciar',    checkout.iniciar);
router.post('/stripe/webhook',      checkout.webhook);
router.get ('/pedido-confirmacion', checkout.confirmacion);

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
