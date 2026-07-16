const router = require('express').Router();
const auth = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./inventario.controller');
const facturas = require('./facturas.controller');

router.use(auth);

router.get('/existencias',          c.existencias);
router.get('/stock',                c.stockProducto);
router.get('/alertas',              c.alertas);
router.get('/movimientos',          c.kardex);
router.get('/productos/:id/lotes',  c.lotesProducto);

router.post('/entradas',            c.entrada);
router.post('/salidas',             c.salida);
router.post('/traspasos',           c.traspaso);
router.post('/ajustes',             c.ajuste);

router.get('/import-existencias/plantilla',  c.plantillaExistencias);
router.post('/import-existencias',           upload.single('archivo'), c.importPreview);
router.post('/import-existencias/confirmar', c.importConfirm);

router.post('/carga-facturas/preview',   upload.single('archivo'), facturas.preview);
router.post('/carga-facturas/confirmar', facturas.confirmar);

module.exports = router;
