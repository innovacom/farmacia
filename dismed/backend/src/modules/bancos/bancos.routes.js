const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requirePermiso } = require('../../middleware/permisos');
const c = require('./bancos.controller');

router.use(auth, requirePermiso('contabilidad-bancos'));

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
