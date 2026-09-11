const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const validarIdNumerico = require('../../middleware/validarIdNumerico');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./pos.controller');
const promos = require('./pos.promociones.controller');
const fidelidad = require('./pos.clientesfidelidad.controller');

// Multer propio para el logo de institución del médico: mismo patrón que el
// logo de empresa (empresas.routes.js) — solo imágenes raster (SVG excluido:
// puede llevar scripts), 2 MB, nombre generado por el server.
const medicosDir = path.join(process.env.UPLOAD_DIR || './uploads', 'medicos');
const logoMedicoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(medicosDir, `medico_${req.params.id}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
    cb(null, `logo-${Date.now()}${ext}`);
  },
});
const uploadLogoMedico = multer({
  storage: logoMedicoStorage,
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes PNG, JPG o WEBP'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Deny-by-default: nada del POS es alcanzable sin usuario autenticado
// con empresa resuelta (tenant.js) y el permiso de menú correspondiente.
router.use(auth, tenant);

// Administración (sucursales y cajas)
// Listar sucursales también lo necesita quien agenda citas (para elegir en
// qué sucursal aparta el horario); crear/editar siguen siendo pos-admin.
router.get('/sucursales',     requireAnyPermiso(['pos-admin', 'pos-citas']), c.listSucursales);
router.post('/sucursales',    requirePermiso('pos-admin'), c.createSucursal);
router.put('/sucursales/:id', requirePermiso('pos-admin'), c.updateSucursal);
// Horario semanal de la sucursal (lo consulta el chatbot de WhatsApp para
// contestar "¿están abiertos?"); solo lo edita pos-admin.
router.get('/sucursales/:id/horarios', requirePermiso('pos-admin'), c.listHorariosSucursal);
router.put('/sucursales/:id/horarios', requirePermiso('pos-admin'), c.setHorariosSucursal);
// Listar cajas requiere solo pos-venta: el cajero necesita elegir su caja
// para encontrar el turno; crear/editar siguen siendo pos-admin.
router.get('/cajas',          requirePermiso('pos-venta'), c.listCajas);
router.post('/cajas',         requirePermiso('pos-admin'), c.createCaja);
router.put('/cajas/:id',      requirePermiso('pos-admin'), c.updateCaja);

// Promociones automáticas del mostrador (admin-only, ver menu.keys.js — no
// se otorga a operadores). Se aplican solas en /ventas y /productos/buscar,
// esto es solo la administración de las reglas.
router.get('/promociones',     requirePermiso('pos-promociones'), promos.listar);
router.post('/promociones',    requirePermiso('pos-promociones'), promos.crear);
router.put('/promociones/:id', requirePermiso('pos-promociones'), promos.actualizar);
router.delete('/promociones/:id', requirePermiso('pos-promociones'), promos.eliminar);

// Clientes de fidelidad (alta rápida nombre+teléfono en mostrador; operable,
// cualquier cajero con el permiso puede registrar — no es admin-only como
// promociones, es captura operativa). Se sincronizan a whatsapp_contactos
// para envío masivo (ver pos.clientesfidelidad.service.js).
router.get('/clientes-fidelidad',        requirePermiso('pos-clientes-fidelidad'), fidelidad.listar);
router.get('/clientes-fidelidad/buscar', requirePermiso('pos-clientes-fidelidad'), fidelidad.buscar);
router.post('/clientes-fidelidad',       requirePermiso('pos-clientes-fidelidad'), fidelidad.crear);
router.put('/clientes-fidelidad/:id',    requirePermiso('pos-clientes-fidelidad'), fidelidad.actualizar);
router.delete('/clientes-fidelidad/:id', requirePermiso('pos-clientes-fidelidad'), fidelidad.eliminar);
// Historial de compras del cliente en mostrador + WhatsApp + tienda web.
router.get('/clientes-fidelidad/:id/historial', requirePermiso('pos-clientes-fidelidad'), fidelidad.historial);

// Venta mostrador
router.get('/productos/buscar',   requirePermiso('pos-venta'),  c.buscarProductos);
router.get('/productos/favoritos', requirePermiso('pos-venta'), c.favoritosProductos);
// Alta rápida de existencia (el producto ya existe en catálogo pero llegó
// mercancía sin pasar antes por Inventario > Movimientos): mismo permiso que
// vender, es parte del flujo normal de mostrador, no de administración.
router.post('/productos/:id/existencia', requirePermiso('pos-venta'), c.registrarExistencia);
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

// Médicos (catálogo compartido: modal de receta en la venta + Expediente
// Médico). ?admin=1 en GET devuelve el listado completo (activos e
// inactivos, sin límite) para la pantalla de alta/baja/modificación.
// LEER el catálogo (elegir médico para una receta/consulta) se otorga con
// 'expediente-medico' (Pacientes) — no hace falta administrar médicos para
// solo consultarlos. ADMINISTRAR el catálogo (alta/edición/horarios/logo)
// exige la clave aparte 'expediente-medicos-admin': un operador con acceso
// solo a Pacientes NO debe poder registrar o editar médicos por su cuenta
// (evita que un doctor se dé de alta a sí mismo o a otro colega). El alta
// inline de médico durante una venta de controlados (ModalReceta.jsx) NO
// pasa por aquí: se inserta dentro de crearVenta (pos.ventas.service.js),
// gatekeeper 'pos-venta' únicamente.
router.get('/medicos',     requireAnyPermiso(['pos-venta', 'expediente-medico', 'expediente-medicos-admin']), c.listMedicos);
router.post('/medicos',    requirePermiso('expediente-medicos-admin'), c.createMedico);
router.put('/medicos/:id', requirePermiso('expediente-medicos-admin'), c.updateMedico);
// Turnos semanales del médico (lo consulta el chatbot de WhatsApp para decir
// quién está en turno ahora mismo); no liga con pos_citas (ver comentario abajo).
router.get('/medicos/:id/horarios', requirePermiso('expediente-medicos-admin'), c.listHorariosMedico);
router.put('/medicos/:id/horarios', requirePermiso('expediente-medicos-admin'), c.setHorariosMedico);
// Logo de institución (se imprime en el cuerpo de la receta). validarIdNumerico
// va antes que multer: el storage usa req.params.id para el nombre de carpeta.
router.post('/medicos/:id/logo', requirePermiso('expediente-medicos-admin'), validarIdNumerico,
  uploadLogoMedico.single('archivo'), c.subirLogoMedico);

// Citas médicas (agenda del mostrador, no importa el médico de guardia).
// Cobrar una cita agendada es una venta normal (pos-venta) que luego se liga
// aquí, por eso /pagar acepta cualquiera de los dos permisos.
router.get('/citas',               requirePermiso('pos-citas'), c.listCitas);
// Antes de '/citas/:id' — si no, ':id' capturaría el literal 'servicios'/'pendientes-confirmar'.
router.get('/citas/servicios',     requirePermiso('pos-citas'), c.listServiciosCitas);
// El recordatorio se muestra en la pantalla de venta (VentaMostrador.jsx), por
// eso también acepta pos-venta aunque quien vende no tenga permiso de agenda.
router.get('/citas/pendientes-confirmar', requireAnyPermiso(['pos-citas', 'pos-venta']), c.citasPendientesConfirmar);
router.get('/citas/:id',           requireAnyPermiso(['pos-citas', 'pos-venta']), c.detalleCita);
router.post('/citas',              requirePermiso('pos-citas'), c.crearCita);
router.put('/citas/:id',           requirePermiso('pos-citas'), c.updateCita);
router.post('/citas/:id/cancelar', requirePermiso('pos-citas'), c.cancelarCita);
router.post('/citas/:id/pagar',    requireAnyPermiso(['pos-citas', 'pos-venta']), c.pagarCita);
router.post('/citas/:id/confirmar', requireAnyPermiso(['pos-citas', 'pos-venta']), c.confirmarCita);
router.post('/citas/:id/recordatorio-whatsapp', requireAnyPermiso(['pos-citas', 'pos-venta']), c.recordatorioWhatsappCita);

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
router.get('/reportes/ventas-producto',     requirePermiso('pos-reportes'), c.reporteVentasProducto);
router.get('/reportes/formas-pago',         requirePermiso('pos-reportes'), c.reporteFormasPago);
router.get('/reportes/existencias',         requirePermiso('pos-reportes'), c.reporteExistencias);
router.get('/reportes/recetas',             requirePermiso('pos-reportes'), c.reporteRecetas);
router.get('/reportes/tickets',             requirePermiso('pos-reportes'), c.reporteTickets);
router.get('/reportes/tickets/:id',         requirePermiso('pos-reportes'), c.reporteTicketDetalle);
router.get('/reportes/ganancias',           requirePermiso('pos-reportes-ganancias'), c.reporteGanancias);
router.get('/reportes/ganancias-productos', requirePermiso('pos-reportes-ganancias'), c.reporteGananciasProductos);
router.get('/reportes/precios-modificados', requirePermiso('pos-reportes-ganancias'), c.reportePreciosModificados);

module.exports = router;
