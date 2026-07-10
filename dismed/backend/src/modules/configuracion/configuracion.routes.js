const router = require('express').Router();
const auth = require('../../middleware/auth');
const ctrl = require('./configuracion.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.get('/', auth, ctrl.get);            // lectura: cualquier usuario autenticado
router.put('/', auth, adminOnly, ctrl.update); // edición: solo admin

module.exports = router;
