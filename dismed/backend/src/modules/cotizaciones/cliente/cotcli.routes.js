const router = require('express').Router();
const auth = require('../../../middleware/auth');
const { requireAnyPermiso } = require('../../../middleware/permisos');
const c = require('./cotcli.controller');

// El Comparador (permiso 'solicitudes') puede crear una cotización directo
// desde ahí; Crear Pedido (permiso 'pedidos') lee la cotización de origen;
// el Dashboard lista cotizaciones recientes.
router.use(auth, requireAnyPermiso(['cotizaciones', 'solicitudes', 'pedidos', 'dashboard']));

router.get('/',                        c.list);
router.get('/:id',                     c.getById);
router.post('/',                       c.create);
router.put('/:id',                     c.update);
router.put('/:id/estatus',             c.cambiarEstatus);
router.get('/:id/pdf',                 c.generarPdf);
router.post('/:id/convertir-pedido',   c.convertirPedido);

module.exports = router;
