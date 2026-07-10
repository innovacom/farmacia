const router = require('express').Router();
const auth = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./solicitudes.controller');

router.use(auth);

router.get('/',                    c.list);
router.get('/:id',                 c.getById);
router.post('/',                   c.create);
router.put('/:id',                 c.update);

// Parsers
router.post('/parse-excel',        upload.single('archivo'), c.parseExcel);
router.post('/parse-pdf',          upload.single('archivo'), c.parsePdf);

// Partidas
router.post('/:id/partidas',              c.addPartida);
router.put('/:id/partidas/:pid',          c.updatePartida);
router.delete('/:id/partidas/:pid',       c.deletePartida);

// Guardar partidas en bloque (después del parser)
router.post('/:id/partidas/bulk',         c.bulkPartidas);

// Búsqueda de precio: 1º catálogo de proveedores (gratis), 2º internet (IA, respaldo)
router.post('/:id/partidas/:pid/buscar-precio-catalogo', c.buscarPrecioCatalogoPartida);
router.post('/:id/partidas/:pid/buscar-precio-web', c.buscarPrecioWebPartida);

// Vista comparador
router.get('/:id/comparador',             c.comparador);

module.exports = router;
