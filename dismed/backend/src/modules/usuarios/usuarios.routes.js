const router = require('express').Router();
const auth   = require('../../middleware/auth');
const ctrl   = require('./usuarios.controller');

const adminOnly = (req, res, next) =>
  req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Se requiere rol admin' });

router.get('/',     auth,            ctrl.list);

// Permisos de menú. Literales/rutas más específicas ANTES de '/:id'.
router.get('/me/permisos',  auth,            ctrl.myPermisos);
router.get('/:id/permisos', auth, adminOnly, ctrl.getPermisos);
router.put('/:id/permisos', auth, adminOnly, ctrl.setPermisos);

router.get('/:id',  auth,            ctrl.getById);
router.post('/',    auth, adminOnly, ctrl.create);
router.put('/:id',  auth, adminOnly, ctrl.update);
router.delete('/:id', auth, adminOnly, ctrl.remove);

module.exports = router;
