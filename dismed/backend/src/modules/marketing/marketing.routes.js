const router = require('express').Router();
const auth = require('../../middleware/auth');
const tenant = require('../../middleware/tenant');
const c = require('./marketing.controller');

// Correos de contacto son datos sensibles — solo admin, mismo guard inline
// que empresas.routes.js (adminOnly nunca es otorgable como permiso normal).
const adminOnly = (req, res, next) =>
  (req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo administradores' }));

router.use(auth, tenant, adminOnly);

router.get('/suscriptores', c.listSuscriptores);

module.exports = router;
