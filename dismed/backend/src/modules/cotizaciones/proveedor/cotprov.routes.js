const router = require('express').Router();
const auth   = require('../../../middleware/auth');
const c      = require('./cotprov.controller');

router.use(auth);

router.post('/',                                      c.iniciar);
router.put('/:id/precios',                            c.registrarPrecios);
router.patch('/:cpId/precios/:partidaId',             c.actualizarPrecioIndividual);
router.get('/solicitud/:solicitudId',                 c.bySolicitud);
router.post('/solicitud/:solicitudId/calcular',       c.calcularMejorPrecio);

module.exports = router;
