const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../../middleware/auth');
const { requirePermiso, requireAnyPermiso } = require('../../middleware/permisos');
const upload = require('../../middleware/upload');
const validarIdNumerico = require('../../middleware/validarIdNumerico');
const c = require('./productos.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

// Multer propio para fotos de producto (catálogo público, ver migrate_v52):
// solo imágenes raster (SVG excluido: puede llevar scripts), 3 MB, nombre
// generado por el server — mismo patrón que empresas.routes.js (logos).
const productosImgDir = path.join(process.env.UPLOAD_DIR || './uploads', 'productos');
const imagenStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(productosImgDir, { recursive: true });
    cb(null, productosImgDir);
  },
  filename: (req, file, cb) => {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
    cb(null, `producto-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadImagen = multer({
  storage: imagenStorage,
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes PNG, JPG o WEBP'), false);
  },
  limits: { fileSize: 3 * 1024 * 1024 },
});

router.use(auth);

// Búsqueda/selección de producto (ProductoPicker) y listado/detalle básico:
// los consume el catálogo de Productos, pero también Solicitudes (armar
// partidas), Movimientos de inventario (buscar producto para un movimiento)
// y Catálogo por proveedor — cualquiera de esos permisos basta para leer.
const permisoLecturaCompartida = requireAnyPermiso(['productos', 'movimientos', 'solicitudes', 'catalogo-proveedor']);
router.get('/',                   permisoLecturaCompartida, c.list);
router.get('/match',               permisoLecturaCompartida, c.match);   // antes de /:id para que no lo capture
router.post('/match-ia',           permisoLecturaCompartida, c.matchIa);   // IA de desempate (lista cerrada)
router.get('/:id/presentaciones',  permisoLecturaCompartida, c.listPresentaciones);
router.get('/:id',                 permisoLecturaCompartida, c.getById);

// Importación del catálogo maestro (xlsx)
router.get('/import-catalogo/plantilla',  requirePermiso('productos'), c.plantillaCatalogo);
router.post('/import-catalogo',           requirePermiso('productos'), upload.single('archivo'), c.importPreview);
router.post('/import-catalogo/confirmar', requirePermiso('productos'), c.importConfirm);

router.post('/baja-masiva', requirePermiso('productos'), c.removeMultiple);
router.get('/exportar',     requirePermiso('productos'), c.exportarExcel);

// Pantalla admin-only de precios y estatus vendible en masa.
router.patch('/:id/venta', adminOnly, c.updateVenta);

// Foto para el catálogo público (tienda), admin-only. validarIdNumerico va
// antes que multer porque el storage usa req.params.id en el nombre del
// archivo — con id no numérico, eso pasaría al filesystem sin validar.
router.post('/:id/imagen', adminOnly, validarIdNumerico, uploadImagen.single('archivo'), c.subirImagen);

// Presentaciones de venta (pieza/paquete sobre la misma existencia — ver migrate_v39)
router.post('/:id/presentaciones', requirePermiso('productos'), c.createPresentacion);
router.put('/presentaciones/:presentacionId',    requirePermiso('productos'), c.updatePresentacion);
router.delete('/presentaciones/:presentacionId', requirePermiso('productos'), c.removePresentacion);

router.post('/',      requirePermiso('productos'), c.create);
router.put('/:id',    requirePermiso('productos'), c.update);
router.delete('/:id', requirePermiso('productos'), c.remove);

module.exports = router;
