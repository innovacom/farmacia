const router = require('express').Router();
const auth = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./herramientas.controller');

router.use(auth);

// Importación (catalogo | equivalencias). dry_run=1 → previsualización.
router.post('/importar/:tipo', upload.single('archivo'), c.importar);

// Plantilla de ejemplo y exportación a Excel (mismo layout que la importación).
router.get('/plantilla/:tipo', c.plantilla);
router.get('/exportar/:tipo',  c.exportar);

module.exports = router;
