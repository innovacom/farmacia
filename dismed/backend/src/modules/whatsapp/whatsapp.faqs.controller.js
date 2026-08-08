const service = require('./whatsapp.faqs.service');
const { wrapAsync } = require('./whatsapp.util');

const listar = wrapAsync(async (req, res) => {
  res.json(await service.listar(req.empresaId));
});

const crear = wrapAsync(async (req, res) => {
  res.status(201).json(await service.crear(req.empresaId, req.body, req.user.id));
});

const actualizar = wrapAsync(async (req, res) => {
  res.json(await service.actualizar(req.empresaId, req.params.id, req.body));
});

const eliminar = wrapAsync(async (req, res) => {
  res.json(await service.eliminar(req.empresaId, req.params.id));
});

module.exports = { listar, crear, actualizar, eliminar };
