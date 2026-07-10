const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./contabilidad.controller');
const pol = require('./polizas.controller');

router.use(auth);

// Reportes contables (cualquier usuario autenticado con permiso de menú).
router.get('/estado-resultados', c.estadoResultados);
router.get('/balance-general', c.balanceGeneral);
router.get('/balanza', c.balanza);

// Reportes CFDI — desglose de impuestos por comprobante y resumen general.
router.get('/cfdi-por-comprobante', c.cfdiPorComprobante);
router.get('/cfdi-resumen-general', c.cfdiResumenGeneral);

// Catálogo de cuentas (Código Agrupador del SAT).
router.get('/catalogo-cuentas', c.catalogoCuentas);

// Pólizas derivadas (CFDI + inventario) y balanza por cuenta real.
router.post('/polizas/generar', pol.generar);
router.post('/polizas/confirmar', pol.confirmarPeriodo);
router.get('/polizas/balanza', pol.balanza);
router.get('/polizas', pol.listar);
router.post('/polizas', pol.crear);
router.get('/polizas/:id', pol.getById);
router.put('/polizas/:id', pol.actualizar);
router.delete('/polizas/:id', pol.eliminar);

module.exports = router;
