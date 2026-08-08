const service = require('./whatsapp.campanas.service');
const { wrapAsync } = require('./whatsapp.util');

const listarPlantillas = wrapAsync(async (req, res) => {
  res.json(await service.listarPlantillasDisponibles());
});

const crear = wrapAsync(async (req, res) => {
  res.status(202).json(await service.crearCampana(req.empresaId, req.body, req.user.id));
});

const listar = wrapAsync(async (req, res) => {
  res.json(await service.listarCampanas(req.empresaId));
});

const detalle = wrapAsync(async (req, res) => {
  res.json(await service.detalleCampana(req.empresaId, req.params.id));
});

module.exports = { listarPlantillas, crear, listar, detalle };
