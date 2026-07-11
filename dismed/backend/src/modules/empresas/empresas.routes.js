const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const c = require('./empresas.controller');

// Guard inline admin-only, mismo patrón que usuarios.routes.js
const adminOnly = (req, res, next) =>
  (req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo administradores' }));

// Multer propio para logos: solo imágenes raster (SVG excluido: puede llevar
// scripts), 2 MB, nombre generado por el server (nunca el original).
const brandingDir = path.join(process.env.UPLOAD_DIR || './uploads', 'branding');
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(brandingDir, `empresa_${req.params.id}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
    cb(null, `logo-${req.query.tipo === 'ticket' ? 'ticket' : 'principal'}-${Date.now()}${ext}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes PNG, JPG o WEBP'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.use(auth);

// Branding de la propia empresa: cualquier usuario autenticado (via tenant)
router.get('/mi-branding', tenant, c.miBranding);

// Administración de tenants: solo admin
router.get('/', adminOnly, c.list);
router.post('/', adminOnly, c.create);
router.put('/:id', adminOnly, c.update);
router.get('/:id/config', adminOnly, c.getConfig);
router.put('/:id/config', adminOnly, c.setConfig);
router.post('/:id/logo', adminOnly, uploadLogo.single('archivo'), c.subirLogo);

module.exports = router;
