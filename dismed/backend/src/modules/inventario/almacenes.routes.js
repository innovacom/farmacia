const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./almacenes.controller');

router.use(auth);

// Lectura: se usa como catálogo de referencia desde Existencias, Movimientos,
// Carga de facturas, Pedidos (surtido) y Sucursales del POS, además de la
// propia página de Almacenes.
const lecturaCompartida = requireAnyPermiso(['almacenes', 'existencias', 'movimientos', 'carga-facturas', 'pedidos', 'pos-admin']);
router.get('/',                       lecturaCompartida, c.listAlmacenes);
router.get('/:id/ubicaciones',        lecturaCompartida, c.listUbicaciones);

// Escritura: solo la página de Almacenes.
router.post('/',                      requirePermiso('almacenes'), c.createAlmacen);
router.put('/:id',                    requirePermiso('almacenes'), c.updateAlmacen);
router.delete('/:id',                 requirePermiso('almacenes'), c.removeAlmacen);
router.post('/:id/ubicaciones',       requirePermiso('almacenes'), c.createUbicacion);
router.put('/:id/ubicaciones/:uid',   requirePermiso('almacenes'), c.updateUbicacion);
router.delete('/:id/ubicaciones/:uid', requirePermiso('almacenes'), c.removeUbicacion);

module.exports = router;
