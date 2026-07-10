const router = require('express').Router();
const apiKeyAuth = require('../../middleware/apiKeyAuth');
const auth = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./ingestion.controller');

// Llamados por n8n (API key, no JWT de usuario).
router.post('/factura-pdf',       apiKeyAuth, upload.single('archivo'), c.recibirFactura);
router.post('/comprobante-pago',  apiKeyAuth, upload.single('archivo'), c.recibirPago);

// Consulta desde el frontend (usuario autenticado).
router.get('/pendientes', auth, c.pendientes);

module.exports = router;
