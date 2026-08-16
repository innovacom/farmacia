const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const upload = require('../../middleware/upload');
const c = require('./inventario.controller');
const facturas = require('./facturas.controller');

router.use(auth);

// Lecturas de stock — compartidas por las páginas Existencias y Movimientos
// (esta última también busca aquí al capturar una entrada/salida), así que
// aceptan cualquiera de los dos permisos.
router.get('/existencias',          requireAnyPermiso(['existencias', 'movimientos']), c.existencias);
router.get('/existencias/exportar', requirePermiso('existencias'), c.exportarExistencias);
router.get('/stock',                requireAnyPermiso(['existencias', 'movimientos']), c.stockProducto);
router.get('/alertas',              requirePermiso('existencias'), c.alertas);
router.get('/fabricantes',          requireAnyPermiso(['existencias', 'movimientos']), c.fabricantes);
router.get('/movimientos',          requirePermiso('movimientos'), c.kardex);
router.get('/productos/:id/lotes',  requireAnyPermiso(['existencias', 'movimientos']), c.lotesProducto);

router.post('/entradas',            requirePermiso('movimientos'), c.entrada);
router.post('/salidas',             requirePermiso('movimientos'), c.salida);
router.post('/traspasos',           requirePermiso('movimientos'), c.traspaso);
router.post('/ajustes',             requirePermiso('movimientos'), c.ajuste);

router.get('/import-existencias/plantilla',  requirePermiso('existencias'), c.plantillaExistencias);
router.post('/import-existencias',           requirePermiso('existencias'), upload.single('archivo'), c.importPreview);
router.post('/import-existencias/confirmar', requirePermiso('existencias'), c.importConfirm);

router.post('/carga-facturas/preview',   requirePermiso('carga-facturas'), upload.single('archivo'), facturas.preview);
router.post('/carga-facturas/confirmar', requirePermiso('carga-facturas'), facturas.confirmar);

module.exports = router;
