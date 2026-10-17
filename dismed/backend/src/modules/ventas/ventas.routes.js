const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./ventas.controller');
const rf = require('./remisiones.facturar');

router.use(auth, requirePermiso('pedidos'));

// Pedidos (asignación del cliente)
router.get('/pedidos',            c.listPedidos);
router.post('/pedidos',           c.crearPedido);
router.get('/pedidos/:id',        c.getPedido);

// Órdenes de compra (desde el pedido)
router.get('/ordenes-compra',              c.listOrdenesCompra);
router.post('/pedidos/:id/ordenes-compra', c.generarOC);
router.get('/ordenes-compra/:id',          c.getOC);
router.get('/ordenes-compra/:id/pdf',      c.ocPdf);
router.post('/ordenes-compra/:id/recepciones', c.recepcion);

// Entregas (remisión/factura)
router.post('/pedidos/:id/entregas', c.crearEntrega);
router.get('/entregas/:id/pdf',      c.entregaPdf);
router.post('/entregas/:id/cfdi-txt', c.cfdiTxt); // genera/regenera el TXT para timbrado

// Timbrado CFDI 4.0 con el PAC Facturama
router.post('/entregas/:id/cfdi/timbrar',  c.timbrarCfdi);
router.post('/entregas/:id/cfdi/cancelar', c.cancelarCfdi);
router.get('/entregas/:id/cfdi',           c.cfdiInfo);

// Facturación consolidada de remisiones (1..N remisiones del mismo cliente → una factura)
router.get('/remisiones/pendientes',          rf.pendientes);
router.post('/remisiones/consolidar/resumen', rf.resumen);
router.post('/remisiones/consolidar',         rf.consolidar);
router.get('/remisiones/facturas',            rf.facturasPendientes);
router.delete('/remisiones/facturas/:id',     rf.descartar);

module.exports = router;
