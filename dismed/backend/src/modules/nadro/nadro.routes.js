// Pedido automático a Nadro: admin-only (igual que supervisor.routes.js) —
// preview es de solo lectura, ejecutar toca dinero real (línea de crédito
// Nadro), por eso ambas rutas quedan fuera del sistema de permisos de
// operadores.
const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const ctrl = require('./nadro.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.use(auth, tenant, adminOnly);

router.get('/preview', ctrl.preview);
router.post('/ejecutar', ctrl.ejecutar);
router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.putConfig);

module.exports = router;
