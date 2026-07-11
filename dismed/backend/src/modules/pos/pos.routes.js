const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./pos.controller');

// Deny-by-default: nada del POS es alcanzable sin usuario autenticado
// con empresa resuelta (tenant.js) y el permiso de menú correspondiente.
router.use(auth, tenant);

// Administración (sucursales y cajas)
router.get('/sucursales',     requirePermiso('pos-admin'), c.listSucursales);
router.post('/sucursales',    requirePermiso('pos-admin'), c.createSucursal);
router.put('/sucursales/:id', requirePermiso('pos-admin'), c.updateSucursal);
router.get('/cajas',          requirePermiso('pos-admin'), c.listCajas);
router.post('/cajas',         requirePermiso('pos-admin'), c.createCaja);
router.put('/cajas/:id',      requirePermiso('pos-admin'), c.updateCaja);

// Venta mostrador
router.get('/productos/buscar',   requirePermiso('pos-venta'),  c.buscarProductos);
router.post('/ventas',            requirePermiso('pos-venta'),  c.crearVenta);
router.get('/ventas',             requirePermiso('pos-venta'),  c.listarVentas);
router.get('/ventas/:id',         requirePermiso('pos-venta'),  c.detalleVenta);
router.post('/ventas/:id/cancelar', requirePermiso('pos-turnos'), c.cancelarVenta);
router.post('/ventas/:id/facturar', requirePermiso('pos-venta'),  c.facturarVenta);

// Facturas globales (XAXX010101000, administración)
router.get('/facturas-globales',              requirePermiso('pos-admin'), c.listarFacturasGlobales);
router.post('/facturas-globales',             requirePermiso('pos-admin'), c.crearFacturaGlobal);
router.post('/facturas-globales/:id/timbrar', requirePermiso('pos-admin'), c.timbrarFacturaGlobal);
router.post('/facturas-globales/:id/liberar', requirePermiso('pos-admin'), c.liberarFacturaGlobal);

// Médicos (los usa el modal de receta en la venta)
router.get('/medicos',     requirePermiso('pos-venta'), c.listMedicos);
router.post('/medicos',    requirePermiso('pos-venta'), c.createMedico);
router.put('/medicos/:id', requirePermiso('pos-venta'), c.updateMedico);

// Bitácora COFEPRIS (controlados/antibióticos)
router.get('/bitacora', requirePermiso('pos-bitacora'), c.bitacora);

// Turnos
router.get('/turnos/actual',           requirePermiso('pos-venta'),  c.turnoActual);
router.get('/turnos',                  requirePermiso('pos-turnos'), c.listTurnos);
router.post('/turnos/abrir',           requirePermiso('pos-turnos'), c.abrirTurno);
router.post('/turnos/:id/movimientos', requirePermiso('pos-turnos'), c.crearMovimiento);
router.get('/turnos/:id/corte',        requirePermiso('pos-turnos'), c.corteTurno);
router.post('/turnos/:id/cerrar',      requirePermiso('pos-turnos'), c.cerrarTurno);

module.exports = router;
