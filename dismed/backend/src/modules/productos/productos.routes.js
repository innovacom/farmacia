const router = require('express').Router();
const auth = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./productos.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.use(auth);
router.get('/',       c.list);
router.get('/match',  c.match);   // antes de /:id para que no lo capture
router.post('/match-ia', c.matchIa);   // IA de desempate (lista cerrada)

// Importación del catálogo maestro (xlsx)
router.get('/import-catalogo/plantilla',  c.plantillaCatalogo);
router.post('/import-catalogo',         upload.single('archivo'), c.importPreview);
router.post('/import-catalogo/confirmar', c.importConfirm);

router.post('/baja-masiva', c.removeMultiple);
router.get('/exportar', c.exportarExcel);

// Pantalla admin-only de precios y estatus vendible en masa.
router.patch('/:id/venta', adminOnly, c.updateVenta);

// Presentaciones de venta (pieza/paquete sobre la misma existencia — ver migrate_v39)
router.get('/:id/presentaciones',  c.listPresentaciones);
router.post('/:id/presentaciones', c.createPresentacion);
router.put('/presentaciones/:presentacionId',    c.updatePresentacion);
router.delete('/presentaciones/:presentacionId', c.removePresentacion);

router.get('/:id',    c.getById);
router.post('/',      c.create);
router.put('/:id',    c.update);
router.delete('/:id', c.remove);

module.exports = router;
