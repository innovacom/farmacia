const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./proveedores.controller');

router.use(auth);

router.get('/',               c.list);
router.post('/baja-masiva',   c.removeMultiple);
router.get('/:id',            c.getById);
router.post('/',              c.create);
router.put('/:id',            c.update);
router.delete('/:id',         c.remove);

// SKUs del proveedor
router.get('/:id/skus',       c.listSkus);

// Catálogo/tarifario del proveedor
router.get('/:id/catalogo',                    c.catalogo);
router.post('/:id/catalogo',                   c.createCatalogo);
router.post('/:id/catalogo/baja-masiva',       c.removeCatalogoMultiple);
router.put('/:id/catalogo/:sku',               c.updateCatalogo);
router.delete('/:id/catalogo/:sku',            c.removeCatalogo);

module.exports = router;
