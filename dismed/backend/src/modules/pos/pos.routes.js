const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./pos.controller');

// Deny-by-default: nada del POS es alcanzable sin usuario autenticado
// con empresa resuelta (tenant.js) y el permiso de menú correspondiente.
router.use(auth, tenant);

// Administración (sucursales y cajas)
// Listar sucursales también lo necesita quien agenda citas (para elegir en
// qué sucursal aparta el horario); crear/editar siguen siendo pos-admin.
router.get('/sucursales',     requireAnyPermiso(['pos-admin', 'pos-citas']), c.listSucursales);
router.post('/sucursales',    requirePermiso('pos-admin'), c.createSucursal);
router.put('/sucursales/:id', requirePermiso('pos-admin'), c.updateSucursal);
// Listar cajas requiere solo pos-venta: el cajero necesita elegir su caja
// para encontrar el turno; crear/editar siguen siendo pos-admin.
router.get('/cajas',          requirePermiso('pos-venta'), c.listCajas);
router.post('/cajas',         requirePermiso('pos-admin'), c.createCaja);
router.put('/cajas/:id',      requirePermiso('pos-admin'), c.updateCaja);

// Venta mostrador
router.get('/productos/buscar',   requirePermiso('pos-venta'),  c.buscarProductos);
router.get('/productos/favoritos', requirePermiso('pos-venta'), c.favoritosProductos);
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

// Médicos (catálogo compartido: modal de receta en la venta + admin de
// Expediente Médico). ?admin=1 en GET devuelve el listado completo (activos
// e inactivos, sin límite) para la pantalla de alta/baja/modificación.
router.get('/medicos',     requireAnyPermiso(['pos-venta', 'expediente-medico']), c.listMedicos);
router.post('/medicos',    requireAnyPermiso(['pos-venta', 'expediente-medico']), c.createMedico);
router.put('/medicos/:id', requireAnyPermiso(['pos-venta', 'expediente-medico']), c.updateMedico);

// Citas médicas (agenda del mostrador, no importa el médico de guardia).
// Cobrar una cita agendada es una venta normal (pos-venta) que luego se liga
// aquí, por eso /pagar acepta cualquiera de los dos permisos.
router.get('/citas',               requirePermiso('pos-citas'), c.listCitas);
// Antes de '/citas/:id' — si no, ':id' capturaría el literal 'servicios'.
router.get('/citas/servicios',     requirePermiso('pos-citas'), c.listServiciosCitas);
router.get('/citas/:id',           requireAnyPermiso(['pos-citas', 'pos-venta']), c.detalleCita);
router.post('/citas',              requirePermiso('pos-citas'), c.crearCita);
router.put('/citas/:id',           requirePermiso('pos-citas'), c.updateCita);
router.post('/citas/:id/cancelar', requirePermiso('pos-citas'), c.cancelarCita);
router.post('/citas/:id/pagar',    requireAnyPermiso(['pos-citas', 'pos-venta']), c.pagarCita);

// Bitácora COFEPRIS (controlados/antibióticos)
router.get('/bitacora', requirePermiso('pos-bitacora'), c.bitacora);

// Turnos
router.get('/turnos/actual',           requirePermiso('pos-venta'),  c.turnoActual);
router.get('/turnos',                  requirePermiso('pos-turnos'), c.listTurnos);
router.post('/turnos/abrir',           requirePermiso('pos-turnos'), c.abrirTurno);
router.post('/turnos/:id/movimientos', requirePermiso('pos-turnos'), c.crearMovimiento);
router.get('/turnos/:id/corte',        requirePermiso('pos-turnos'), c.corteTurno);
router.post('/turnos/:id/cerrar',      requirePermiso('pos-turnos'), c.cerrarTurno);
router.post('/turnos/:id/autorizar',   requirePermiso('pos-turnos'), c.autorizarSupervisorCierre);
// Desglose completo del arqueo (fondo/ventas/salidas): solo rol=admin, ver desgloseTurno.
router.get('/turnos/:id/desglose',     requirePermiso('pos-turnos'), c.desgloseTurno);

// Dashboard / Reportes. Grupo A: operativos (ventas, existencias, recetas).
// Grupo B: ganancia/margen, permiso APARTE ('pos-reportes-ganancias') para
// que el admin decida quién ve el dato sensible, igual que Descargas SAT.
router.get('/reportes/resumen',             requirePermiso('pos-reportes'), c.reporteResumen);
router.get('/reportes/ventas-sucursal',     requirePermiso('pos-reportes'), c.reporteVentasSucursal);
router.get('/reportes/top-productos',       requirePermiso('pos-reportes'), c.reporteTopProductos);
router.get('/reportes/formas-pago',         requirePermiso('pos-reportes'), c.reporteFormasPago);
router.get('/reportes/existencias',         requirePermiso('pos-reportes'), c.reporteExistencias);
router.get('/reportes/recetas',             requirePermiso('pos-reportes'), c.reporteRecetas);
router.get('/reportes/ganancias',           requirePermiso('pos-reportes-ganancias'), c.reporteGanancias);
router.get('/reportes/ganancias-productos', requirePermiso('pos-reportes-ganancias'), c.reporteGananciasProductos);

module.exports = router;
