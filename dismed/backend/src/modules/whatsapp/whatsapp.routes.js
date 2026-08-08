const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./whatsapp.controller');
const contactos = require('./whatsapp.contactos.controller');
const mensajeria = require('./whatsapp.mensajeria.controller');
const campanas = require('./whatsapp.campanas.controller');
const faqs = require('./whatsapp.faqs.controller');
const config = require('./whatsapp.config.controller');
const pedidos = require('./whatsapp.pedidos.controller');

// Webhook: lo llama Meta directamente, sin JWT — la seguridad es la firma
// X-Hub-Signature-256 (ver whatsapp.controller.firmaValida), no el login.
router.get('/webhook', c.webhookVerify);
router.post('/webhook', c.webhookReceive);

// Estado de configuración: lo consulta el frontend para decidir si mostrar
// el botón de envío automático o el enlace wa.me manual de respaldo.
router.get('/estado', auth, tenant, c.estado);

// Bandeja general (recibir/enviar/guardar mensajes) y libreta de contactos —
// mismo permiso, es una sola pantalla con dos pestañas.
router.get('/conversaciones',                        auth, tenant, requirePermiso('whatsapp-bandeja'), mensajeria.listarConversaciones);
router.get('/conversaciones/pendientes-responder',   auth, tenant, requirePermiso('whatsapp-bandeja'), mensajeria.pendientesResponder);
router.get('/conversaciones/:contactoId/mensajes',   auth, tenant, requirePermiso('whatsapp-bandeja'), mensajeria.listarMensajes);
router.post('/conversaciones/:contactoId/mensajes',  auth, tenant, requirePermiso('whatsapp-bandeja'), mensajeria.enviar);
router.post('/conversaciones/:contactoId/leido',     auth, tenant, requirePermiso('whatsapp-bandeja'), mensajeria.marcarLeido);

router.get('/contactos',            auth, tenant, requirePermiso('whatsapp-bandeja'), contactos.listar);
router.get('/contactos/etiquetas',  auth, tenant, requirePermiso('whatsapp-bandeja'), contactos.listarEtiquetas);
router.post('/contactos',           auth, tenant, requirePermiso('whatsapp-bandeja'), contactos.crear);
router.put('/contactos/:id',        auth, tenant, requirePermiso('whatsapp-bandeja'), contactos.actualizar);

// Envío masivo (promociones): permiso aparte, solo lo otorga el admin — igual
// que Descargas SAT o Precios y estatus de venta, por el costo/alcance que
// implica escribirle a muchos contactos a la vez.
router.get('/campanas/plantillas', auth, tenant, requirePermiso('whatsapp-masivos'), campanas.listarPlantillas);
router.get('/campanas',            auth, tenant, requirePermiso('whatsapp-masivos'), campanas.listar);
router.get('/campanas/:id',        auth, tenant, requirePermiso('whatsapp-masivos'), campanas.detalle);
router.post('/campanas',           auth, tenant, requirePermiso('whatsapp-masivos'), campanas.crear);

// Preguntas frecuentes del chatbot: solo admin, definen las respuestas fijas
// que usa whatsapp.chatbot.service.js para mensajes libres de negocio (no
// dependientes de la BD, a diferencia de horario/médico en turno/producto).
router.get('/faqs',        auth, tenant, requirePermiso('whatsapp-faqs'), faqs.listar);
router.post('/faqs',       auth, tenant, requirePermiso('whatsapp-faqs'), faqs.crear);
router.put('/faqs/:id',    auth, tenant, requirePermiso('whatsapp-faqs'), faqs.actualizar);
router.delete('/faqs/:id', auth, tenant, requirePermiso('whatsapp-faqs'), faqs.eliminar);

// Saludo de bienvenida: mismo permiso/pantalla que las preguntas frecuentes
// (ver whatsapp.service.js#procesarMensajeEntrante).
router.get('/config/saludo', auth, tenant, requirePermiso('whatsapp-faqs'), config.get);
router.put('/config/saludo', auth, tenant, requirePermiso('whatsapp-faqs'), config.update);

// Pedidos en firme armados por el carrito conversacional (ver
// whatsapp.carrito.service.js) — pantalla operativa de farmacia/mostrador,
// mismo permiso que el resto del POS de venta.
router.get('/pedidos',                    auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.listar);
router.get('/pedidos/:id',                auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.detalle);
router.get('/pedidos/:id/receta',         auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.receta);
router.post('/pedidos/:id/receta/validar', auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.validarReceta);
router.post('/pedidos/:id/preparar',      auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.preparar);
router.post('/pedidos/:id/listo',         auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.listo);
router.post('/pedidos/:id/reparto',       auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.reparto);
router.post('/pedidos/:id/entregar',      auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.entregar);
router.post('/pedidos/:id/cancelar',      auth, tenant, requirePermiso('pos-pedidos-whatsapp'), pedidos.cancelar);

module.exports = router;
