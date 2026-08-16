const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./proveedores.controller');

router.use(auth);

// Listado: también se usa como catálogo de referencia desde Exportar datos
// y desde Detalle de Solicitud (para iniciar cotización a proveedores).
router.get('/',               requireAnyPermiso(['proveedores', 'herramientas-exportar', 'solicitudes']), c.list);
router.post('/baja-masiva',   requirePermiso('proveedores'), c.removeMultiple);
router.get('/:id',            requirePermiso('proveedores'), c.getById);
router.post('/',              requirePermiso('proveedores'), c.create);
router.put('/:id',            requirePermiso('proveedores'), c.update);
router.delete('/:id',         requirePermiso('proveedores'), c.remove);

// SKUs del proveedor
router.get('/:id/skus',       requirePermiso('proveedores'), c.listSkus);

// Catálogo/tarifario del proveedor
router.get('/:id/catalogo',                    requirePermiso('catalogo-proveedor'), c.catalogo);
router.post('/:id/catalogo',                   requirePermiso('catalogo-proveedor'), c.createCatalogo);
router.post('/:id/catalogo/baja-masiva',       requirePermiso('catalogo-proveedor'), c.removeCatalogoMultiple);
router.put('/:id/catalogo/:sku',               requirePermiso('catalogo-proveedor'), c.updateCatalogo);
router.delete('/:id/catalogo/:sku',            requirePermiso('catalogo-proveedor'), c.removeCatalogo);

module.exports = router;
