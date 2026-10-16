const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireAnyPermiso } = require('../../middleware/permisos');
const c = require('./clientes.controller');

// 'solicitudes' también puede leer/crear clientes: Nueva Solicitud permite
// dar de alta un cliente y su contacto inline sin salir del flujo.
router.use(auth, requireAnyPermiso(['clientes', 'solicitudes']));

router.get('/',              c.list);
router.get('/:id',           c.getById);
router.post('/',             c.create);
router.put('/:id',           c.update);
router.delete('/:id',        c.remove);

// Contactos
router.get('/:id/contactos',      c.listContactos);
router.post('/:id/contactos',     c.createContacto);
router.put('/:id/contactos/:cid', c.updateContacto);

// Sucursales
router.get('/:id/sucursales',        c.listSucursales);
router.post('/:id/sucursales',       c.createSucursal);
router.put('/:id/sucursales/:sid',   c.updateSucursal);
router.post('/:id/fusionar',         c.fusionar);

// SKUs del cliente (diccionario de equivalencias)
router.get('/:id/skus',      c.listSkus);

module.exports = router;
