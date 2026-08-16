const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const upload = require('../../middleware/upload');
const c = require('./catalogos.controller');

router.use(auth);

// Lectura: familias/categorías/subcategorías/unidades se usan como filtros
// desde Catálogo de productos y Promociones del POS, además de esta página.
const lecturaCompartida = requireAnyPermiso(['catalogos-apoyo', 'productos', 'pos-promociones']);

router.get('/import/plantilla',  requirePermiso('catalogos-apoyo'), c.plantillaImport);
router.post('/import',           requirePermiso('catalogos-apoyo'), upload.single('archivo'), c.importPreview);
router.post('/import/confirmar', requirePermiso('catalogos-apoyo'), c.importConfirm);

router.get('/familias',          lecturaCompartida, c.listFamilias);
router.post('/familias',         requirePermiso('catalogos-apoyo'), c.createFamilia);
router.put('/familias/:id',      requirePermiso('catalogos-apoyo'), c.updateFamilia);
router.delete('/familias/:id',   requirePermiso('catalogos-apoyo'), c.removeFamilia);

router.get('/categorias',        lecturaCompartida, c.listCategorias);
router.post('/categorias',       requirePermiso('catalogos-apoyo'), c.createCategoria);
router.put('/categorias/:id',    requirePermiso('catalogos-apoyo'), c.updateCategoria);
router.delete('/categorias/:id', requirePermiso('catalogos-apoyo'), c.removeCategoria);

router.get('/subcategorias',     lecturaCompartida, c.listSubcategorias);
router.post('/subcategorias',    requirePermiso('catalogos-apoyo'), c.createSubcategoria);
router.put('/subcategorias/:id', requirePermiso('catalogos-apoyo'), c.updateSubcategoria);
router.delete('/subcategorias/:id', requirePermiso('catalogos-apoyo'), c.removeSubcategoria);

router.get('/unidades',          lecturaCompartida, c.listUnidades);
router.post('/unidades',         requirePermiso('catalogos-apoyo'), c.createUnidad);
router.put('/unidades/:id',      requirePermiso('catalogos-apoyo'), c.updateUnidad);
router.delete('/unidades/:id',   requirePermiso('catalogos-apoyo'), c.removeUnidad);

module.exports = router;
