const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./cobranza.controller');

router.use(auth, requirePermiso('cobranza'));

router.get('/resumen',               c.resumen);
router.get('/clientes/:id',          c.detalleCliente);
router.post('/cobros',               c.crearCobro);
router.post('/cobros/:id/cancelar',  c.cancelarCobro);
router.put('/config',                c.putConfig); // solo admin (validado en el controlador)

module.exports = router;
