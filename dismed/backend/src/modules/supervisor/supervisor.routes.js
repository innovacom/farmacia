// Panel de Supervisor: admin-only (igual que configuracion.routes.js /
// empresas / usuarios) — no pasa por el sistema de permisos de operadores.
const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const ctrl = require('./supervisor.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.use(auth, tenant, adminOnly);

router.get('/panel', ctrl.panel);
router.get('/umbrales', ctrl.getUmbrales);
router.put('/umbrales', ctrl.putUmbrales);
router.post('/alertas/probar', ctrl.probarAlerta);
router.post('/alertas/prueba-whatsapp', ctrl.pruebaWhatsapp);

module.exports = router;
