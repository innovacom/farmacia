const router = require('express').Router();
const auth   = require('../../../middleware/auth');
const { requireAnyPermiso } = require('../../../middleware/permisos');
const c      = require('./cotprov.controller');

// Todo este flujo (iniciar cotización a proveedores, registrar precios) se
// usa desde DetalleSolicitud/Comparador/RegistrarPrecios, anidados bajo
// /solicitudes/:id/... y por tanto gateados por el permiso 'solicitudes'
// en el frontend, no 'cotizaciones'.
router.use(auth, requireAnyPermiso(['solicitudes', 'cotizaciones']));

router.post('/',                                      c.iniciar);
router.put('/:id/precios',                            c.registrarPrecios);
router.patch('/:cpId/precios/:partidaId',             c.actualizarPrecioIndividual);
router.get('/solicitud/:solicitudId',                 c.bySolicitud);
router.post('/solicitud/:solicitudId/calcular',       c.calcularMejorPrecio);

module.exports = router;
