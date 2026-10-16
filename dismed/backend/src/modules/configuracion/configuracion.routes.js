const router = require('express').Router();
const auth = require('../../middleware/auth');
const ctrl = require('./configuracion.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.get('/', auth, ctrl.get);            // lectura: cualquier usuario autenticado
router.put('/', auth, adminOnly, ctrl.update); // edición: solo admin

// PAC de timbrado CFDI y ambiente (solo admin)
router.get('/cfdi', auth, adminOnly, ctrl.getCfdi);
router.put('/cfdi', auth, adminOnly, ctrl.putCfdi);
router.get('/cfdi/saldo', auth, adminOnly, ctrl.saldoCfdi);

module.exports = router;
