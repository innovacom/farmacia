const router = require('express').Router();
const auth = require('../../middleware/auth');
const c = require('./clientes.controller');

router.use(auth);

router.get('/',              c.list);
router.get('/:id',           c.getById);
router.post('/',             c.create);
router.put('/:id',           c.update);
router.delete('/:id',        c.remove);

// Contactos
router.get('/:id/contactos',      c.listContactos);
router.post('/:id/contactos',     c.createContacto);
router.put('/:id/contactos/:cid', c.updateContacto);

// SKUs del cliente (diccionario de equivalencias)
router.get('/:id/skus',      c.listSkus);

module.exports = router;
