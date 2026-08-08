const service = require('./whatsapp.contactos.service');
const { wrapAsync } = require('./whatsapp.util');

const listar = wrapAsync(async (req, res) => {
  res.json(await service.listarContactos(req.empresaId, req.query));
});

const listarEtiquetas = wrapAsync(async (req, res) => {
  res.json(await service.listarEtiquetas(req.empresaId));
});

const crear = wrapAsync(async (req, res) => {
  res.status(201).json(await service.crearContactoManual(req.empresaId, req.body, req.user.id));
});

const actualizar = wrapAsync(async (req, res) => {
  res.json(await service.actualizarContacto(req.empresaId, req.params.id, req.body));
});

module.exports = { listar, listarEtiquetas, crear, actualizar };
