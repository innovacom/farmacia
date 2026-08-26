const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./contabilidad.controller');
const pol = require('./polizas.controller');
const ape = require('./apertura.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.use(auth);

// Reportes contables — cada uno con su propia clave de menú (ver menu.keys.js).
router.get('/estado-resultados', requirePermiso('contabilidad-estado-resultados'), c.estadoResultados);
router.get('/balance-general',   requirePermiso('contabilidad-balance-general'),   c.balanceGeneral);
router.get('/balanza',           requirePermiso('contabilidad-balanza'),           c.balanza);

// Reportes CFDI — desglose de impuestos por comprobante y resumen general.
router.get('/cfdi-por-comprobante', requirePermiso('contabilidad-cfdi-por-comprobante'), c.cfdiPorComprobante);
router.get('/cfdi-resumen-general', requirePermiso('contabilidad-cfdi-resumen-general'), c.cfdiResumenGeneral);

// Catálogo de cuentas (Código Agrupador del SAT) — el componente compartido
// CuentaContableSelect lo consume también desde Productos, Proveedores,
// Clientes y Bancos (para asignar cuenta contable a cada registro).
router.get('/catalogo-cuentas', requireAnyPermiso([
  'contabilidad-catalogo-cuentas', 'contabilidad-polizas', 'contabilidad-bancos',
  'productos', 'proveedores', 'clientes',
]), c.catalogoCuentas);

// Cuentas auxiliares (nivel 3, detalle) — catálogo + estado de cuenta por
// subcuenta. Comparte permiso con catálogo de cuentas y pólizas.
router.get('/auxiliares', requireAnyPermiso([
  'contabilidad-catalogo-cuentas', 'contabilidad-polizas',
]), c.auxiliaresListar);
router.post('/auxiliares', requirePermiso('contabilidad-catalogo-cuentas'), c.auxiliaresCrear);
router.put('/auxiliares/:id', requirePermiso('contabilidad-catalogo-cuentas'), c.auxiliaresActualizar);
router.get('/estado-cuenta', requireAnyPermiso([
  'contabilidad-catalogo-cuentas', 'contabilidad-polizas',
]), c.estadoCuenta);

// Pólizas derivadas (CFDI + inventario) y balanza por cuenta real.
router.post('/polizas/generar',   requirePermiso('contabilidad-polizas'), pol.generar);
router.post('/polizas/confirmar', requirePermiso('contabilidad-polizas'), pol.confirmarPeriodo);
router.get('/polizas/balanza',    requirePermiso('contabilidad-polizas'), pol.balanza);
router.get('/polizas',            requirePermiso('contabilidad-polizas'), pol.listar);
router.post('/polizas',           requirePermiso('contabilidad-polizas'), pol.crear);
router.get('/polizas/:id',        requirePermiso('contabilidad-polizas'), pol.getById);
router.put('/polizas/:id',        requirePermiso('contabilidad-polizas'), pol.actualizar);
router.delete('/polizas/:id',     requirePermiso('contabilidad-polizas'), pol.eliminar);

// Saldos iniciales / apertura del ejercicio — solo admin (reescribe el punto de
// partida contable, igual de sensible que Descargas SAT).
router.get('/apertura',    adminOnly, ape.obtener);
router.post('/apertura',   adminOnly, ape.guardar);
router.delete('/apertura', adminOnly, ape.eliminar);

module.exports = router;
