const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const upload = require('../../middleware/upload');
const c = require('./herramientas.controller');

router.use(auth);

// Importación (catalogo | equivalencias). dry_run=1 → previsualización.
router.post('/importar/:tipo', requirePermiso('herramientas-importar'), upload.single('archivo'), c.importar);

// Plantilla de ejemplo (parte del flujo de importación) y exportación a Excel.
router.get('/plantilla/:tipo', requirePermiso('herramientas-importar'), c.plantilla);
router.get('/exportar/:tipo',  requirePermiso('herramientas-exportar'), c.exportar);

module.exports = router;
