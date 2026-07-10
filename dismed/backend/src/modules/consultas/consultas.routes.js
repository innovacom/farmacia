const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./consultas.controller');

router.use(auth);

// Listados ENCABEZADO (q, codigo, sku, fecha_desde, fecha_hasta, limit, offset)
router.get('/solicitudes',     c.listSolicitudes);
router.get('/cotizaciones',    c.listCotizaciones);
router.get('/ordenes-compra',  c.listOrdenesCompra);
router.get('/pedidos',         c.listPedidos);

// Búsqueda DETALLE: renglones que cumplen el criterio (q, fecha_desde, fecha_hasta)
// ⚠️ Deben ir ANTES de las rutas con :id para que no las capture el parámetro.
router.get('/solicitudes/partidas',    c.partidasSolicitudes);
router.get('/cotizaciones/partidas',   c.partidasCotizaciones);
router.get('/ordenes-compra/partidas', c.partidasOrdenesCompra);
router.get('/pedidos/partidas',        c.partidasPedidos);

// Detalle completo (header + partidas) para drill-down
router.get('/solicitudes/:id',     c.detalleSolicitud);
router.get('/cotizaciones/:id',    c.detalleCotizacion);
router.get('/ordenes-compra/:id',  c.detalleOrdenCompra);
router.get('/pedidos/:id',         c.detallePedido);

module.exports = router;
