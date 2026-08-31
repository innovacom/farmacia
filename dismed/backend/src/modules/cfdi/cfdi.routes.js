const router = require('express').Router();
const multer = require('multer');
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./cfdi.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

// Subida de XML sueltos: se guardan en memoria y se parsean al vuelo (no hay
// que dejarlos en disco antes de validarlos). Se filtra por extensión .xml —
// Chrome/Windows a veces manda mimetype vacío o application/octet-stream. Se usa
// .any() y un wrapper que traduce los errores de multer a un 400 legible.
const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 200 },
  fileFilter: (req, file, cb) =>
    (/\.xml$/i.test(file.originalname) ? cb(null, true) : cb(new Error(`"${file.originalname}" no es un .xml`), false)),
});
const recibirXml = (req, res, next) => {
  uploadXml.any()(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'No se pudieron leer los archivos' });
    next();
  });
};

router.use(auth);

// ── Descargas masivas: solo admin (bitácora + disparadores). Literales ANTES de /:tipo.
router.get('/fiel', adminOnly, c.validarFiel);
router.delete('/repositorio', adminOnly, c.purgarRepositorio);   // borra todo el repositorio CFDI
router.get('/descargas', adminOnly, c.listDescargas);
router.post('/descargas', adminOnly, c.crearDescarga);
router.post('/descargas/batch', adminOnly, c.descargaBatch);     // carga histórica mes a mes
router.post('/subir-xml', adminOnly, recibirXml, c.subirXml); // XML sueltos (otros medios)
router.post('/descargas/procesar-pendientes', adminOnly, c.procesarPendientes);
router.post('/descargas/:id/procesar', adminOnly, c.procesarDescarga);
router.delete('/descargas/:id', adminOnly, c.eliminarDescarga);

// Reconciliar estatus vigente/cancelado por metadata del SAT (solo admin).
router.post('/estatus/reconciliar', adminOnly, c.reconciliarEstatus);

// ── Consulta (cualquier usuario autenticado con permiso de menú 'cfdi').
// Drill-down de un comprobante (header + conceptos).
router.get('/comprobante/:id', requirePermiso('cfdi'), c.detalleComprobante);
// El PDF también lo abre el detalle de una póliza contable (módulo Contabilidad),
// no solo la consulta directa de CFDI — se acepta cualquiera de los dos permisos.
router.get('/comprobante/:id/pdf', requireAnyPermiso(['cfdi', 'contabilidad-polizas']), c.pdfComprobante);

// Consulta encabezado/detalle por tipo (emitidos|recibidos).
router.get('/:tipo/conceptos', requirePermiso('cfdi'), c.listConceptos);
router.get('/:tipo', requirePermiso('cfdi'), c.listComprobantes);

module.exports = router;
