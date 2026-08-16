const router = require('express').Router();
const apiKeyAuth = require('../../middleware/apiKeyAuth');
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const upload = require('../../middleware/upload');
const c = require('./ingestion.controller');

// Llamados por n8n (API key, no JWT de usuario).
router.post('/factura-pdf',       apiKeyAuth, upload.single('archivo'), c.recibirFactura);
router.post('/comprobante-pago',  apiKeyAuth, upload.single('archivo'), c.recibirPago);

// Consulta desde el frontend (usuario autenticado, mismo permiso que la
// carga manual de facturas — ambas son "carga de facturas" para el operador).
router.get('/pendientes', auth, requirePermiso('carga-facturas'), c.pendientes);

module.exports = router;
