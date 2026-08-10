// Rutas del catálogo público — SIN auth (a diferencia de todo el resto del
// sistema). Ver tienda.controller.js para el detalle de qué expone.
const router = require('express').Router();
const c = require('./tienda.controller');

router.get('/info',          c.info);
router.get('/categorias',    c.categorias);
router.get('/productos',     c.productosList);
router.get('/productos/:id', c.productoDetalle);

module.exports = router;
