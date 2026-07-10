const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./bancos.controller');

router.use(auth);

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
