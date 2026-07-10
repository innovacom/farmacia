const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./catalogos.controller');

router.use(auth);

router.get('/familias',          c.listFamilias);
router.post('/familias',         c.createFamilia);
router.put('/familias/:id',      c.updateFamilia);

router.get('/categorias',        c.listCategorias);
router.post('/categorias',       c.createCategoria);
router.put('/categorias/:id',    c.updateCategoria);

router.get('/subcategorias',     c.listSubcategorias);
router.post('/subcategorias',    c.createSubcategoria);
router.put('/subcategorias/:id', c.updateSubcategoria);

router.get('/unidades',          c.listUnidades);
router.post('/unidades',         c.createUnidad);
router.put('/unidades/:id',      c.updateUnidad);

module.exports = router;
