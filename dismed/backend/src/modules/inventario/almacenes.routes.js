const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./almacenes.controller');

router.use(auth);

router.get('/',                       c.listAlmacenes);
router.post('/',                      c.createAlmacen);
router.put('/:id',                    c.updateAlmacen);
router.delete('/:id',                 c.removeAlmacen);
router.get('/:id/ubicaciones',        c.listUbicaciones);
router.post('/:id/ubicaciones',       c.createUbicacion);
router.put('/:id/ubicaciones/:uid',   c.updateUbicacion);
router.delete('/:id/ubicaciones/:uid', c.removeUbicacion);

module.exports = router;
