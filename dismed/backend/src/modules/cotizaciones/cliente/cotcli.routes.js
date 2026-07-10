const router = require('express').Router();
const auth = require('../../../middleware/auth');
const c = require('./cotcli.controller');

router.use(auth);

router.get('/',                        c.list);
router.get('/:id',                     c.getById);
router.post('/',                       c.create);
router.put('/:id',                     c.update);
router.put('/:id/estatus',             c.cambiarEstatus);
router.get('/:id/pdf',                 c.generarPdf);
router.post('/:id/convertir-pedido',   c.convertirPedido);

module.exports = router;
