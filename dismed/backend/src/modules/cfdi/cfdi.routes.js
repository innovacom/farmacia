const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./cfdi.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.use(auth);

// ── Descargas masivas: solo admin (bitácora + disparadores). Literales ANTES de /:tipo.
router.get('/fiel', adminOnly, c.validarFiel);
router.delete('/repositorio', adminOnly, c.purgarRepositorio);   // borra todo el repositorio CFDI
router.get('/descargas', adminOnly, c.listDescargas);
router.post('/descargas', adminOnly, c.crearDescarga);
router.post('/descargas/batch', adminOnly, c.descargaBatch);     // carga histórica mes a mes
router.post('/descargas/procesar-pendientes', adminOnly, c.procesarPendientes);
router.post('/descargas/:id/procesar', adminOnly, c.procesarDescarga);
router.delete('/descargas/:id', adminOnly, c.eliminarDescarga);

// Reconciliar estatus vigente/cancelado por metadata del SAT (solo admin).
router.post('/estatus/reconciliar', adminOnly, c.reconciliarEstatus);

// ── Consulta (cualquier usuario autenticado con permiso de menú 'cfdi').
// Drill-down de un comprobante (header + conceptos).
router.get('/comprobante/:id', c.detalleComprobante);

// Consulta encabezado/detalle por tipo (emitidos|recibidos).
router.get('/:tipo/conceptos', c.listConceptos);
router.get('/:tipo', c.listComprobantes);

module.exports = router;
